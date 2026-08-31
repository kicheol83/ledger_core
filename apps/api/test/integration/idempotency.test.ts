import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PG_POOL } from '../../src/shared/database/executor.js';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter.js';

describe('Idempotency', () => {
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
    await pool.query('DELETE FROM idempotency_keys');
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
      [`idem-${Date.now()}-${Math.random()}@example.test`],
    );
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
      [user.rows[0]!.id],
    );
    return account.rows[0]!.id;
  }

  async function fund(accountId: string, amount: string): Promise<void> {
    await http()
      .post('/deposits')
      .set('idempotency-key', randomUUID())
      .send({ accountId, amount, currency: 'UZS' })
      .expect(201);
  }

  async function balanceOf(accountId: string): Promise<string> {
    const response = await http().get(`/accounts/${accountId}/balance`).expect(200);
    return response.body.amount;
  }

  describe('header requirement', () => {
    it('rejects a write without an idempotency key', async () => {
      const account = await makeAccount();

      await http()
        .post('/deposits')
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(400);
    });

    it('rejects a key that is too short to be unique', async () => {
      const account = await makeAccount();

      await http()
        .post('/deposits')
        .set('idempotency-key', 'abc')
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(400);
    });

    it('does not require a key on reads', async () => {
      const account = await makeAccount();
      await http().get(`/accounts/${account}/balance`).expect(200);
    });
  });

  describe('replay', () => {
    it('applies a repeated request only once', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      const first = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      const second = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(await balanceOf(account)).toBe('5000');
    });

    it('returns the stored response byte for byte', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      const first = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      await fund(account, '3000');

      const replay = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);

      expect(replay.body).toEqual(first.body);
      expect(replay.body.balance).toBe('5000');
    });

    it('marks the replay with a header', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      const replay = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      expect(replay.headers['idempotent-replay']).toBe('true');
    });

    it('survives five identical retries', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/deposits')
          .set('idempotency-key', key)
          .send({ accountId: account, amount: '1000', currency: 'UZS' })
          .expect(201);
      }

      expect(await balanceOf(account)).toBe('1000');
    });

    it('ignores key ordering in the body', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      const replay = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ currency: 'UZS', amount: '1000', accountId: account })
        .expect(201);

      expect(replay.headers['idempotent-replay']).toBe('true');
    });
  });

  describe('key reuse', () => {
    it('rejects the same key with a different body', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      const response = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '9999', currency: 'UZS' })
        .expect(422);

      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await balanceOf(account)).toBe('1000');
    });

    it('rejects the same key on a different endpoint', async () => {
      const account = await makeAccount();
      await fund(account, '10000');
      const key = randomUUID();

      await http()
        .post('/withdrawals')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(422);
    });
  });

  describe('atomicity', () => {
    it('does not consume a key when the operation fails', async () => {
      const account = await makeAccount();
      await fund(account, '1000');
      const key = randomUUID();

      await http()
        .post('/withdrawals')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(422);

      const keys = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      expect(keys.rows[0]!.count).toBe('0');

      await fund(account, '10000');

      await http()
        .post('/withdrawals')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '5000', currency: 'UZS' })
        .expect(201);
    });

    it('links the stored key to the transaction it created', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      const response = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      const stored = await pool.query<{ transaction_id: string }>(
        `SELECT transaction_id FROM idempotency_keys WHERE key = $1`,
        [key],
      );

      expect(stored.rows[0]!.transaction_id).toBe(response.body.id);
    });
  });

  describe('concurrency', () => {
    it('applies only one of two simultaneous identical requests', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      const results = await Promise.allSettled([
        http()
          .post('/deposits')
          .set('idempotency-key', key)
          .send({ accountId: account, amount: '5000', currency: 'UZS' }),
        http()
          .post('/deposits')
          .set('idempotency-key', key)
          .send({ accountId: account, amount: '5000', currency: 'UZS' }),
      ]);

      const succeeded = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );

      expect(succeeded).toHaveLength(2);
      expect(await balanceOf(account)).toBe('5000');

      const transactions = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions WHERE type = 'DEPOSIT'`,
      );
      expect(transactions.rows[0]!.count).toBe('1');
    });

    it('holds under five simultaneous retries of one transfer', async () => {
      const from = await makeAccount();
      const to = await makeAccount();
      await fund(from, '10000');
      const key = randomUUID();

      await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          http()
            .post('/transfers')
            .set('idempotency-key', key)
            .send({ fromAccountId: from, toAccountId: to, amount: '3000', currency: 'UZS' }),
        ),
      );

      expect(await balanceOf(from)).toBe('7000');
      expect(await balanceOf(to)).toBe('3000');

      const violations = await pool.query('SELECT * FROM verify_ledger_integrity()');
      expect(violations.rows).toEqual([]);
    });
  });

  describe('expiry', () => {
    it('purges keys past their expiry', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      await pool.query(
        `UPDATE idempotency_keys
            SET created_at = now() - interval '48 hours',
                expires_at = now() - interval '1 hour'
          WHERE key = $1`,
        [key],
      );

      const purged = await pool.query<{ purge_expired_idempotency_keys: number }>(
        'SELECT purge_expired_idempotency_keys(100)',
      );

      expect(purged.rows[0]!.purge_expired_idempotency_keys).toBeGreaterThanOrEqual(1);
    });

    it('leaves unexpired keys alone', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      await pool.query('SELECT purge_expired_idempotency_keys(100)');

      const remaining = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      expect(remaining.rows[0]!.count).toBe('1');
    });
  });
});
