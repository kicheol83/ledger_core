import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';

describe('Reversals', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    pool = app.get<Pool>(PG_POOL);
  });

  beforeEach(async () => {
    await pool.query('SELECT test_reset_ledger()');
    await pool.query(`INSERT INTO accounts (type, currency) VALUES ('SYSTEM', 'UZS')`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function makeAccount(): Promise<string> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`rev-${Date.now()}-${Math.random()}@example.test`],
    );

    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
      [user.rows[0]!.id],
    );

    return account.rows[0]!.id;
  }

  async function deposit(accountId: string, amount: string): Promise<void> {
    await http()
      .post('/deposits')
      .set('idempotency-key', randomUUID())
      .send({ accountId, amount, currency: 'UZS' })
      .expect(201);
  }

  async function transfer(from: string, to: string, amount: string): Promise<string> {
    const response = await http()
      .post('/transfers')
      .set('idempotency-key', randomUUID())
      .send({ fromAccountId: from, toAccountId: to, amount, currency: 'UZS' })
      .expect(201);
    return response.body.id;
  }

  async function balanceOf(accountId: string): Promise<string> {
    const response = await http().get(`/accounts/${accountId}/balance`).expect(200);
    return response.body.amount;
  }

  describe('POST /transactions/:id/reversal', () => {
    it('restores both balances', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');

      const transferId = await transfer(alice, bob, '3000');

      expect(await balanceOf(alice)).toBe('7000');
      expect(await balanceOf(bob)).toBe('3000');

      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({ reason: 'customer disputed the charge' })
        .expect(201);

      expect(await balanceOf(alice)).toBe('10000');
      expect(await balanceOf(bob)).toBe('0');
    });

    it('leaves the original entries untouched', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const original = await http().get(`/transactions/${transferId}`).expect(200);

      expect(original.body.entries).toHaveLength(2);
      expect(original.body.amount).toBe('3000');
      expect(original.body.status).toBe('REVERSED');
    });

    it('writes mirrored entries', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const reversal = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const detail = await http().get(`/transactions/${reversal.body.id}`).expect(200);

      expect(detail.body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: bob, direction: 'DEBIT', amount: '3000' }),
          expect.objectContaining({ accountId: alice, direction: 'CREDIT', amount: '3000' }),
        ]),
      );
    });

    it('links the reversal to the original', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const response = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      expect(response.body.reversesId).toBe(transferId);
      expect(response.body.originalStatus).toBe('REVERSED');
    });

    it('records the reason in metadata', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const reversal = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({ reason: 'duplicate submission' })
        .expect(201);

      const detail = await http().get(`/transactions/${reversal.body.id}`).expect(200);
      expect(detail.body.metadata.reason).toBe('duplicate submission');
    });

    it('keeps the ledger balanced', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');
      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const reconciliation = await http()
        .get('/ledger/reconciliation')
        .query({ currency: 'UZS' })
        .expect(200);

      expect(reconciliation.body.balanced).toBe(true);

      const violations = await pool.query('SELECT * FROM verify_ledger_integrity()');
      expect(violations.rows).toEqual([]);
    });

    it('reverses a deposit', async () => {
      const alice = await makeAccount();
      const depositResponse = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: alice, amount: '5000', currency: 'UZS' })
        .expect(201);

      await http()
        .post(`/transactions/${depositResponse.body.id}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({ reason: 'deposit failed at the payment provider' })
        .expect(201);

      expect(await balanceOf(alice)).toBe('0');
    });

    it('shows both movements in account history', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');
      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const history = await http().get('/transactions').query({ accountId: bob }).expect(200);

      const types = history.body.transactions.map((t: { type: string }) => t.type);
      expect(types).toContain('TRANSFER');
      expect(types).toContain('REVERSAL');
    });
  });

  describe('guards', () => {
    it('refuses to reverse the same transaction twice', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const response = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(409);

      expect(response.body.code).toBe('ALREADY_REVERSED');
    });

    it('refuses to reverse a reversal', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const reversal = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const response = await http()
        .post(`/transactions/${reversal.body.id}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(409);

      expect(response.body.code).toBe('TRANSACTION_NOT_REVERSIBLE');
    });

    it('refuses when the recipient has already spent the money', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      const carol = await makeAccount();
      await deposit(alice, '10000');

      const transferId = await transfer(alice, bob, '3000');
      await transfer(bob, carol, '3000');

      const response = await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(422);

      expect(response.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(await balanceOf(bob)).toBe('0');
    });

    it('returns 404 for an unknown transaction', async () => {
      await http()
        .post('/transactions/00000000-0000-0000-0000-000000000000/reversal')
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(404);
    });

    it('writes nothing when it refuses', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      const carol = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');
      await transfer(bob, carol, '3000');

      await http()
        .post(`/transactions/${transferId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(422);

      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions WHERE type = 'REVERSAL'`,
      );

      expect(count.rows[0]!.count).toBe('0');

      const original = await http().get(`/transactions/${transferId}`).expect(200);
      expect(original.body.status).toBe('COMPLETED');
    });
  });

  describe('concurrency', () => {
    it('lets only one of two simultaneous reversals succeed', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const results = await Promise.allSettled([
        http()
          .post(`/transactions/${transferId}/reversal`)
          .set('idempotency-key', randomUUID())
          .send({}),
        http()
          .post(`/transactions/${transferId}/reversal`)
          .set('idempotency-key', randomUUID())
          .send({}),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);

      expect(await balanceOf(alice)).toBe('10000');
      expect(await balanceOf(bob)).toBe('0');

      const reversalCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions WHERE reverses_id = $1`,
        [transferId],
      );
      expect(reversalCount.rows[0]!.count).toBe('1');
    });

    it('handles a reversal racing a transfer out of the same account', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();
      const carol = await makeAccount();
      await deposit(alice, '10000');
      const transferId = await transfer(alice, bob, '3000');

      const results = await Promise.allSettled([
        http()
          .post(`/transactions/${transferId}/reversal`)
          .set('idempotency-key', randomUUID())
          .send({}),
        http()
          .post('/transfers')
          .set('idempotency-key', randomUUID())
          .send({ fromAccountId: bob, toAccountId: carol, amount: '3000', currency: 'UZS' }),
      ]);

      const succeeded = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      expect(BigInt(await balanceOf(bob))).toBeGreaterThanOrEqual(0n);

      const violations = await pool.query('SELECT * FROM verify_ledger_integrity()');
      expect(violations.rows).toEqual([]);
    });
  });
});
