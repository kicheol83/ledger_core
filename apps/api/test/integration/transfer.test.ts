import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { TransactionRepository } from '../../src/modules/ledger/infrastructure/transaction.repository.js';
import { PG_POOL } from '../../src/shared/database/executor.js';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter.js';

describe('Transfers', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    pool = app.get<Pool>(PG_POOL);
  });

  beforeEach(async () => {
    await pool.query('SELECT test_reset_ledger()');
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function setup(currency = 'UZS'): Promise<{ a: string; b: string; system: string }> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`tr-${Date.now()}-${Math.random()}@example.test`],
    );

    const accounts = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, $2), ($1, $2) RETURNING id`,
      [user.rows[0]!.id, currency],
    );

    const system = await pool.query<{ id: string }>(
      `INSERT INTO accounts (type, currency) VALUES ('SYSTEM', $1) RETURNING id`,
      [currency],
    );

    return { a: accounts.rows[0]!.id, b: accounts.rows[1]!.id, system: system.rows[0]!.id };
  }

  async function fund(accountId: string, systemId: string, amount: bigint): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tx = await client.query<{ id: string }>(
        `INSERT INTO transactions (type, status, amount, currency, completed_at)
         VALUES ('DEPOSIT', 'COMPLETED', $1, 'UZS', now()) RETURNING id`,
        [amount.toString()],
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
         VALUES ($1, $2, 'DEBIT', $4), ($1, $3, 'CREDIT', $4)`,
        [tx.rows[0]!.id, systemId, accountId, amount.toString()],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function balanceOf(accountId: string): Promise<string> {
    const response = await http().get(`/accounts/${accountId}/balance`).expect(200);
    return response.body.amount;
  }

  describe('POST /transfers', () => {
    it('moves money and returns both balances', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '3000', currency: 'UZS' })
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'COMPLETED',
        amount: '3000',
        currency: 'UZS',
        balances: { from: '7000', to: '3000' },
      });
    });

    it('writes exactly two entries, one on each side', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      const created = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '3000', currency: 'UZS' })
        .expect(201);

      const detail = await http().get(`/transactions/${created.body.id}`).expect(200);

      expect(detail.body.entries).toHaveLength(2);
      expect(detail.body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: a, direction: 'DEBIT', amount: '3000' }),
          expect.objectContaining({ accountId: b, direction: 'CREDIT', amount: '3000' }),
        ]),
      );
    });

    it('leaves the ledger balanced', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);
      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '3000', currency: 'UZS' })
        .expect(201);

      const reconciliation = await http()
        .get('/ledger/reconciliation')
        .query({ currency: 'UZS' })
        .expect(200);

      expect(reconciliation.body.balanced).toBe(true);
    });

    it('rejects a transfer larger than the balance', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 1_000n);

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '5000', currency: 'UZS' })
        .expect(422);

      expect(response.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(response.body.errors).toMatchObject({
        available: '1000',
        requested: '5000',
        shortfall: '4000',
      });
    });

    it('writes nothing when it rejects', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 1_000n);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '5000', currency: 'UZS' })
        .expect(422);

      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions WHERE type = 'TRANSFER'`,
      );

      expect(count.rows[0]!.count).toBe('0');
      expect(await balanceOf(a)).toBe('1000');
    });

    it('allows a transfer that empties the account exactly', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 5_000n);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '5000', currency: 'UZS' })
        .expect(201);

      expect(await balanceOf(a)).toBe('0');
    });

    it('rejects a transfer to the same account', async () => {
      const { a } = await setup();

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: a, amount: '100', currency: 'UZS' })
        .expect(422);

      expect(response.body.code).toBe('SAME_ACCOUNT_TRANSFER');
    });

    it('rejects a transfer from a frozen account', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);
      await pool.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1`, [a]);

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '100', currency: 'UZS' })
        .expect(409);

      expect(response.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects a transfer to a frozen account', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);
      await pool.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1`, [b]);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '100', currency: 'UZS' })
        .expect(409);
    });

    it('rejects a currency mismatch', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '100', currency: 'KRW' })
        .expect(422);

      expect(response.body.code).toBe('CURRENCY_MISMATCH');
    });

    it('returns 404 for an unknown account', async () => {
      const { a, system } = await setup();
      await fund(a, system, 10_000n);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({
          fromAccountId: a,
          toAccountId: '00000000-0000-0000-0000-000000000000',
          amount: '100',
          currency: 'UZS',
        })
        .expect(404);
    });

    it('rejects a zero or negative amount', async () => {
      const { a, b } = await setup();

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '0', currency: 'UZS' })
        .expect(400);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: '-100', currency: 'UZS' })
        .expect(400);
    });

    it('rejects an amount sent as a JSON number', async () => {
      const { a, b } = await setup();

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: a, toAccountId: b, amount: 100, currency: 'UZS' })
        .expect(400);
    });

    it('preserves amounts beyond Number.MAX_SAFE_INTEGER', async () => {
      const { a, b, system } = await setup();
      const huge = 9_007_199_254_740_993n;
      await fund(a, system, huge);

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({
          fromAccountId: a,
          toAccountId: b,
          amount: huge.toString(),
          currency: 'UZS',
        })
        .expect(201);

      expect(response.body.balances.to).toBe('9007199254740993');
    });

    it('stores metadata', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      const created = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({
          fromAccountId: a,
          toAccountId: b,
          amount: '100',
          currency: 'UZS',
          metadata: { reference: 'INV-42' },
        })
        .expect(201);

      const detail = await http().get(`/transactions/${created.body.id}`).expect(200);
      expect(detail.body.metadata).toEqual({ reference: 'INV-42' });
    });
  });

  describe('GET /transactions', () => {
    it('returns history newest first', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      for (const amount of ['100', '200', '300']) {
        await http()
          .post('/transfers')
          .set('idempotency-key', randomUUID())
          .send({ fromAccountId: a, toAccountId: b, amount, currency: 'UZS' })
          .expect(201);
      }

      const response = await http().get('/transactions').query({ accountId: a }).expect(200);

      expect(response.body.transactions[0].amount).toBe('300');
      expect(response.body.transactions).toHaveLength(4);
    });

    it('paginates by keyset cursor', async () => {
      const { a, b, system } = await setup();
      await fund(a, system, 10_000n);

      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/transfers')
          .set('idempotency-key', randomUUID())
          .send({ fromAccountId: a, toAccountId: b, amount: '100', currency: 'UZS' })
          .expect(201);
      }

      const first = await http().get('/transactions').query({ accountId: a, limit: 2 }).expect(200);

      expect(first.body.transactions).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await http()
        .get('/transactions')
        .query({ accountId: a, limit: 2, beforeEntryId: first.body.nextCursor })
        .expect(200);

      const firstIds = first.body.transactions.map((t: { id: string }) => t.id);
      const secondIds = second.body.transactions.map((t: { id: string }) => t.id);

      expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
    });

    it('reports a null cursor on the last page', async () => {
      const { a, system } = await setup();
      await fund(a, system, 1_000n);

      const response = await http()
        .get('/transactions')
        .query({ accountId: a, limit: 20 })
        .expect(200);

      expect(response.body.nextCursor).toBeNull();
    });
  });

  describe('lock acquisition', () => {
    it('locks account rows in sorted order', async () => {
      const { a, b } = await setup();

      const plan = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, currency, status, type
                   FROM accounts
                  WHERE id = ANY($1::uuid[])
                  ORDER BY id
                    FOR UPDATE`,
        [[a, b].sort()],
      );

      const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
      const lockRowsAt = text.indexOf('LockRows');
      const sortAt = text.search(/Sort|Index Scan using accounts_pkey/);

      expect(lockRowsAt).toBeGreaterThanOrEqual(0);
      expect(sortAt).toBeGreaterThan(lockRowsAt);
    });

    it('refuses to lock outside a transaction', async () => {
      const repository = app.get(TransactionRepository);

      await expect(
        repository.lockAccounts(['00000000-0000-0000-0000-000000000000']),
      ).rejects.toThrow(/must be called inside a transaction/);
    });
  });
});
