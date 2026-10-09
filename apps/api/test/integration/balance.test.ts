import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';

describe('Balance derivation', () => {
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

  async function seedAccounts(currency = 'UZS'): Promise<{ a: string; b: string; userId: string }> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`bal-${Date.now()}-${Math.random()}@example.test`],
    );
    const userId = user.rows[0]!.id;

    const accounts = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency)
       VALUES ($1, $2), ($1, $2) RETURNING id`,
      [userId, currency],
    );

    return { a: accounts.rows[0]!.id, b: accounts.rows[1]!.id, userId };
  }

  async function postTransfer(from: string, to: string, amount: bigint): Promise<string> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tx = await client.query<{ id: string }>(
        `INSERT INTO transactions (type, status, amount, currency, completed_at)
         VALUES ('TRANSFER', 'COMPLETED', $1, 'UZS', now()) RETURNING id`,
        [amount.toString()],
      );
      const id = tx.rows[0]!.id;

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
         VALUES ($1, $2, 'DEBIT', $4), ($1, $3, 'CREDIT', $4)`,
        [id, from, to, amount.toString()],
      );

      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  describe('GET /accounts/:id/balance', () => {
    it('returns zero for an account with no entries', async () => {
      const { a } = await seedAccounts();

      const response = await http().get(`/accounts/${a}/balance`).expect(200);

      expect(response.body).toMatchObject({
        amount: '0',
        currency: 'UZS',
        entryCount: 0,
        asOfEntryId: null,
      });
    });

    it('derives the balance from entries', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 5_000n);

      const debited = await http().get(`/accounts/${a}/balance`).expect(200);
      const credited = await http().get(`/accounts/${b}/balance`).expect(200);

      expect(debited.body.amount).toBe('-5000');
      expect(credited.body.amount).toBe('5000');
    });

    it('accumulates across many entries', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 1_000n);
      await postTransfer(a, b, 2_000n);
      await postTransfer(b, a, 500n);

      const response = await http().get(`/accounts/${a}/balance`).expect(200);

      expect(response.body.amount).toBe('-2500');
      expect(response.body.entryCount).toBe(3);
    });

    it('returns amounts as strings, not numbers', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 9_007_199_254_740_993n);

      const response = await http().get(`/accounts/${b}/balance`).expect(200);

      expect(response.body.amount).toBe('9007199254740993');
      expect(typeof response.body.amount).toBe('string');
    });

    it('returns 404 for an unknown account', async () => {
      const response = await http()
        .get('/accounts/00000000-0000-0000-0000-000000000000/balance')
        .expect(404);

      expect(response.body.code).toBe('ACCOUNT_NOT_FOUND');
    });

    it('reads the balance with a single pooled statement', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 100n);

      const query = vi.spyOn(pool, 'query');

      try {
        const response = await http().get(`/accounts/${b}/balance`).expect(200);

        expect(response.body.amount).toBe('100');
        expect(query).toHaveBeenCalledTimes(1);
      } finally {
        query.mockRestore();
      }
    });
  });

  describe('historical balances', () => {
    it('returns the balance as it stood at an earlier entry', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 1_000n);

      const afterFirst = await http().get(`/accounts/${a}/balance`).expect(200);
      const watermark = afterFirst.body.asOfEntryId;

      await postTransfer(a, b, 4_000n);

      const now = await http().get(`/accounts/${a}/balance`).expect(200);
      const historical = await http()
        .get(`/accounts/${a}/balance`)
        .query({ asOfEntryId: watermark })
        .expect(200);

      expect(now.body.amount).toBe('-5000');
      expect(historical.body.amount).toBe('-1000');
    });

    it('is stable: the same watermark always gives the same answer', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 1_000n);

      const first = await http().get(`/accounts/${a}/balance`).expect(200);
      const watermark = first.body.asOfEntryId;

      await postTransfer(a, b, 9_000n);

      const again = await http()
        .get(`/accounts/${a}/balance`)
        .query({ asOfEntryId: watermark })
        .expect(200);

      expect(again.body.amount).toBe(first.body.amount);
    });

    it('rejects a non-numeric watermark', async () => {
      const { a } = await seedAccounts();

      await http().get(`/accounts/${a}/balance`).query({ asOfEntryId: 'abc' }).expect(400);
    });
  });

  describe('GET /balances', () => {
    it('returns every account of a user, including empty ones', async () => {
      const { a, b, userId } = await seedAccounts();
      await postTransfer(a, b, 3_000n);

      const response = await http().get('/balances').query({ userId }).expect(200);

      expect(response.body.balances).toHaveLength(2);
      const amounts = response.body.balances.map((x: { amount: string }) => x.amount).sort();
      expect(amounts).toEqual(['-3000', '3000']);
    });
  });

  describe('GET /ledger/reconciliation', () => {
    it('reports zero imbalance when every transaction balances', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 5_000n);
      await postTransfer(b, a, 1_234n);

      const response = await http()
        .get('/ledger/reconciliation')
        .query({ currency: 'UZS' })
        .expect(200);

      expect(response.body).toMatchObject({ imbalance: '0', balanced: true });
    });
  });

  describe('query plan', () => {
    it('has a covering index over exactly the columns the balance query reads', async () => {
      const result = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'ledger_entries'
            AND indexname = 'ledger_entries_balance_idx'`,
      );

      expect(result.rowCount).toBe(1);

      const definition = result.rows[0]!.indexdef;

      expect(definition).toMatch(/\(account_id, id\)/);

      expect(definition).toMatch(/INCLUDE \(direction, amount\)/);
    });

    it('reads a balance without reading anything else', async () => {
      const { a, b } = await seedAccounts();
      await postTransfer(a, b, 100n);

      const plan = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (VERBOSE)
         SELECT coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)
           FROM ledger_entries
          WHERE account_id = $1`,
        [a],
      );

      const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');

      const output = /Output: ([^\n]+)/.exec(text)?.[1] ?? '';
      expect(output).not.toMatch(/created_at|transaction_id/);
    });
  });
});
