import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PG_POOL } from '../../src/shared/database/executor.js';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter.js';

describe('Deposits and withdrawals', () => {
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

    await pool.query(
      `INSERT INTO accounts (type, currency) VALUES ('SYSTEM', 'UZS'), ('SYSTEM', 'KRW')`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function makeAccount(currency = 'UZS'): Promise<string> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`fund-${Date.now()}-${Math.random()}@example.test`],
    );

    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, $2) RETURNING id`,
      [user.rows[0]!.id, currency],
    );

    return account.rows[0]!.id;
  }

  async function systemBalance(currency = 'UZS'): Promise<string> {
    const result = await pool.query<{ balance: string }>(
      `SELECT coalesce(sum(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)::text
                AS balance
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE a.type = 'SYSTEM' AND a.currency = $1`,
      [currency],
    );
    return result.rows[0]!.balance;
  }

  describe('POST /deposits', () => {
    it('credits the account and returns the new balance', async () => {
      const account = await makeAccount();

      const response = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '10000', currency: 'UZS' })
        .expect(201);

      expect(response.body).toMatchObject({
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: '10000',
        balance: '10000',
      });
    });

    it('writes two entries with the system account as counterparty', async () => {
      const account = await makeAccount();

      const created = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '10000', currency: 'UZS' })
        .expect(201);

      const detail = await http().get(`/transactions/${created.body.id}`).expect(200);

      expect(detail.body.entries).toHaveLength(2);
      expect(detail.body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: account, direction: 'CREDIT', amount: '10000' }),
          expect.objectContaining({ direction: 'DEBIT', amount: '10000' }),
        ]),
      );
    });

    it('drives the system account negative, which is correct', async () => {
      const account = await makeAccount();

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '10000', currency: 'UZS' })
        .expect(201);

      expect(await systemBalance()).toBe('-10000');

      const reconciliation = await http()
        .get('/ledger/reconciliation')
        .query({ currency: 'UZS' })
        .expect(200);

      expect(reconciliation.body.balanced).toBe(true);
    });

    it('never rejects a deposit because the system account is negative', async () => {
      const first = await makeAccount();
      const second = await makeAccount();

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: first, amount: '1000000', currency: 'UZS' })
        .expect(201);

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: second, amount: '1000000', currency: 'UZS' })
        .expect(201);

      expect(await systemBalance()).toBe('-2000000');
    });

    it('accumulates across deposits', async () => {
      const account = await makeAccount();

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '3000', currency: 'UZS' })
        .expect(201);

      const second = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '4000', currency: 'UZS' })
        .expect(201);

      expect(second.body.balance).toBe('7000');
    });

    it('rejects a deposit into a frozen account', async () => {
      const account = await makeAccount();
      await pool.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1`, [account]);

      const response = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(409);

      expect(response.body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects a deposit into the system account itself', async () => {
      const system = await pool.query<{ id: string }>(
        `SELECT id FROM accounts WHERE type = 'SYSTEM' AND currency = 'UZS'`,
      );

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: system.rows[0]!.id, amount: '1000', currency: 'UZS' })
        .expect(409);
    });

    it('rejects a currency the account does not hold', async () => {
      const account = await makeAccount('UZS');

      const response = await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '1000', currency: 'KRW' })
        .expect(422);

      expect(response.body.code).toBe('CURRENCY_MISMATCH');
    });

    it('returns 404 when no system account exists for the currency', async () => {
      await pool.query(`DELETE FROM accounts WHERE type = 'SYSTEM' AND currency = 'KRW'`);
      const account = await makeAccount('KRW');

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '1000', currency: 'KRW' })
        .expect(404);
    });
  });

  describe('POST /withdrawals', () => {
    async function funded(amount: string, currency = 'UZS'): Promise<string> {
      const account = await makeAccount(currency);
      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount, currency })
        .expect(201);
      return account;
    }

    it('debits the account and returns the new balance', async () => {
      const account = await funded('10000');

      const response = await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '4000', currency: 'UZS' })
        .expect(201);

      expect(response.body).toMatchObject({
        type: 'WITHDRAWAL',
        amount: '4000',
        balance: '6000',
      });
    });

    it('returns the system account towards zero', async () => {
      const account = await funded('10000');
      expect(await systemBalance()).toBe('-10000');

      await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '10000', currency: 'UZS' })
        .expect(201);

      expect(await systemBalance()).toBe('0');
    });

    it('rejects a withdrawal larger than the balance', async () => {
      const account = await funded('1000');

      const response = await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(422);

      expect(response.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(response.body.errors.shortfall).toBe('4000');
    });

    it('allows withdrawing the exact balance', async () => {
      const account = await funded('5000');

      const response = await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      expect(response.body.balance).toBe('0');
    });

    it('writes nothing when it rejects', async () => {
      const account = await funded('1000');

      await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(422);

      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions WHERE type = 'WITHDRAWAL'`,
      );

      expect(count.rows[0]!.count).toBe('0');
    });

    it('rejects a withdrawal from a frozen account', async () => {
      const account = await funded('10000');
      await pool.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1`, [account]);

      await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(409);
    });
  });

  describe('full lifecycle', () => {
    it('keeps the ledger balanced through deposit, transfer and withdrawal', async () => {
      const alice = await makeAccount();
      const bob = await makeAccount();

      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: alice, amount: '10000', currency: 'UZS' })
        .expect(201);

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: alice, toAccountId: bob, amount: '3000', currency: 'UZS' })
        .expect(201);

      await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: bob, amount: '1000', currency: 'UZS' })
        .expect(201);

      const aliceBalance = await http().get(`/accounts/${alice}/balance`).expect(200);
      const bobBalance = await http().get(`/accounts/${bob}/balance`).expect(200);

      expect(aliceBalance.body.amount).toBe('7000');
      expect(bobBalance.body.amount).toBe('2000');

      expect(await systemBalance()).toBe('-9000');

      const violations = await pool.query('SELECT * FROM verify_ledger_integrity()');
      expect(violations.rows).toEqual([]);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two simultaneous withdrawals succeed', async () => {
      const account = await makeAccount();
      await http()
        .post('/deposits')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      const results = await Promise.allSettled([
        http()
          .post('/withdrawals')
          .set('idempotency-key', randomUUID())
          .send({ accountId: account, amount: '5000', currency: 'UZS' }),
        http()
          .post('/withdrawals')
          .set('idempotency-key', randomUUID())
          .send({ accountId: account, amount: '5000', currency: 'UZS' }),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 422)).toHaveLength(1);
    });

    it('handles many concurrent deposits to different accounts', async () => {
      const accounts = await Promise.all(Array.from({ length: 10 }, () => makeAccount()));

      const results = await Promise.allSettled(
        accounts.map((account) =>
          http()
            .post('/deposits')
            .set('idempotency-key', randomUUID())
            .send({ accountId: account, amount: '1000', currency: 'UZS' }),
        ),
      );

      const succeeded = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );

      expect(succeeded).toHaveLength(10);
      expect(await systemBalance()).toBe('-10000');
    });
  });
});
