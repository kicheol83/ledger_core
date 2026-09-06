import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg, { type Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';

describe('Concurrency', () => {
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

  async function makeAccounts(count: number, currency = 'UZS'): Promise<string[]> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`cc-${Date.now()}-${Math.random()}@example.test`],
    );

    const values = Array.from({ length: count }, () => `($1, $2)`).join(', ');
    const accounts = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ${values} RETURNING id`,
      [user.rows[0]!.id, currency],
    );

    return accounts.rows.map((row) => row.id);
  }

  async function systemAccount(currency = 'UZS'): Promise<string> {
    await pool.query(
      `INSERT INTO accounts (type, currency) VALUES ('SYSTEM', $1) ON CONFLICT DO NOTHING`,
      [currency],
    );

    const result = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE type = 'SYSTEM' AND currency = $1`,
      [currency],
    );

    return result.rows[0]!.id;
  }

  async function fund(accountId: string, amount: bigint, currency = 'UZS'): Promise<void> {
    const system = await systemAccount(currency);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tx = await client.query<{ id: string }>(
        `INSERT INTO transactions (type, status, amount, currency, completed_at)
         VALUES ('DEPOSIT', 'COMPLETED', $1, $2, now()) RETURNING id`,
        [amount.toString(), currency],
      );

      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
         VALUES ($1, $2, 'DEBIT', $4), ($1, $3, 'CREDIT', $4)`,
        [tx.rows[0]!.id, system, accountId, amount.toString()],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function balanceOf(accountId: string): Promise<bigint> {
    const result = await pool.query<{ balance: string }>(
      `SELECT coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::text
                AS balance
         FROM ledger_entries WHERE account_id = $1`,
      [accountId],
    );
    return BigInt(result.rows[0]!.balance);
  }

  function transfer(
    from: string,
    to: string,
    amount: string,
  ): ReturnType<ReturnType<typeof request>['post']> {
    return http()
      .post('/transfers')
      .set('idempotency-key', randomUUID())
      .send({ fromAccountId: from, toAccountId: to, amount, currency: 'UZS' });
  }

  async function assertLedgerIntact(): Promise<void> {
    const violations = await pool.query('SELECT * FROM verify_ledger_integrity()');
    expect(violations.rows).toEqual([]);

    const imbalance = await pool.query<{ imbalance: string }>(
      `SELECT coalesce(sum(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END), 0)::text
                AS imbalance
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE a.currency = 'UZS'`,
    );
    expect(imbalance.rows[0]!.imbalance).toBe('0');
  }

  describe('double spend', () => {
    it('lets exactly one of two simultaneous transfers succeed', async () => {
      const [source, first, second] = await makeAccounts(3);
      await fund(source!, 5_000n);

      const results = await Promise.allSettled([
        transfer(source!, first!, '5000'),
        transfer(source!, second!, '5000'),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 422)).toHaveLength(1);

      expect(await balanceOf(source!)).toBe(0n);
      await assertLedgerIntact();
    });

    it('holds under ten simultaneous attempts on one balance', async () => {
      const [source, ...destinations] = await makeAccounts(11);
      await fund(source!, 3_000n);

      const results = await Promise.allSettled(
        destinations.map((destination) => transfer(source!, destination, '1000')),
      );

      const succeeded = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );

      expect(succeeded).toHaveLength(3);
      expect(await balanceOf(source!)).toBe(0n);
      await assertLedgerIntact();
    });

    it('never lets a balance go negative under sustained contention', async () => {
      const [source, sink] = await makeAccounts(2);
      await fund(source!, 10_000n);

      const attempts = Array.from({ length: 40 }, () =>
        transfer(source!, sink!, String(200 + Math.floor(Math.random() * 800))),
      );

      await Promise.allSettled(attempts);

      const balance = await balanceOf(source!);
      expect(balance).toBeGreaterThanOrEqual(0n);
      expect(balance + (await balanceOf(sink!))).toBe(10_000n);
      await assertLedgerIntact();
    });
  });

  describe('deadlock avoidance', () => {
    it('handles transfers in opposite directions between the same pair', async () => {
      const [a, b] = await makeAccounts(2);
      await fund(a!, 10_000n);
      await fund(b!, 10_000n);

      const results = await Promise.allSettled([
        transfer(a!, b!, '1000'),
        transfer(b!, a!, '1000'),
        transfer(a!, b!, '2000'),
        transfer(b!, a!, '2000'),
      ]);

      for (const result of results) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBe(201);
        }
      }

      expect(await balanceOf(a!)).toBe(10_000n);
      expect(await balanceOf(b!)).toBe(10_000n);
      await assertLedgerIntact();
    });

    it('survives a chain of transfers across many accounts', async () => {
      const accounts = await makeAccounts(8);
      await Promise.all(accounts.map((account) => fund(account, 5_000n)));

      const ring = accounts.map((from, index) => {
        const to = accounts[(index + 1) % accounts.length]!;
        return transfer(from, to, '1000');
      });

      const results = await Promise.allSettled(ring);

      for (const result of results) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBe(201);
        }
      }

      for (const account of accounts) {
        expect(await balanceOf(account)).toBe(5_000n);
      }
      await assertLedgerIntact();
    });

    it('demonstrates the deadlock the ordering prevents', async () => {
      const [a, b] = await makeAccounts(2);
      const [low, high] = [a!, b!].sort();

      const clientOne = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
      const clientTwo = new pg.Client({ connectionString: process.env['DATABASE_URL'] });

      await clientOne.connect();
      await clientTwo.connect();

      try {
        await clientOne.query('BEGIN');
        await clientTwo.query('BEGIN');

        await clientOne.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [low]);
        await clientTwo.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [high]);

        const outcomes = await Promise.allSettled([
          clientOne.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [high]),
          clientTwo.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [low]),
        ]);

        const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
        expect(rejected).toHaveLength(1);

        const error = (rejected[0] as PromiseRejectedResult).reason as { code?: string };

        expect(['40P01', '55P03']).toContain(error.code);
      } finally {
        await clientOne.query('ROLLBACK').catch(() => undefined);
        await clientTwo.query('ROLLBACK').catch(() => undefined);
        await clientOne.end();
        await clientTwo.end();
      }
    });
  });

  describe('serialisation', () => {
    it("makes the second transfer see the first one's effect", async () => {
      const [source, destination] = await makeAccounts(2);
      await fund(source!, 10_000n);

      const [first, second] = await Promise.all([
        transfer(source!, destination!, '6000'),
        transfer(source!, destination!, '6000'),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 422]);

      const failed = first.status === 422 ? first : second;

      expect(failed.body.errors.available).toBe('4000');
    });

    it('blocks an administrative freeze from interleaving with a transfer', async () => {
      const [source, destination] = await makeAccounts(2);
      await fund(source!, 10_000n);

      const results = await Promise.allSettled([
        transfer(source!, destination!, '1000'),
        http().patch(`/accounts/${source!}/status`).send({ status: 'FROZEN' }),
      ]);

      for (const result of results) {
        expect(result.status).toBe('fulfilled');
      }

      const finalBalance = await balanceOf(source!);
      expect([9_000n, 10_000n]).toContain(finalBalance);
      await assertLedgerIntact();
    });
  });

  describe('throughput on disjoint accounts', () => {
    it('runs unrelated transfers without contending', async () => {
      const accounts = await makeAccounts(40);
      const sources = accounts.slice(0, 20);
      const destinations = accounts.slice(20);

      await Promise.all(sources.map((account) => fund(account, 1_000n)));

      const started = Date.now();
      const results = await Promise.allSettled(
        sources.map((source, index) => transfer(source, destinations[index]!, '1000')),
      );
      const elapsed = Date.now() - started;

      const succeeded = results.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 201,
      );

      expect(succeeded).toHaveLength(20);

      expect(elapsed).toBeLessThan(10_000);

      await assertLedgerIntact();
    });
  });

  describe('invariants under load', () => {
    it('keeps the ledger balanced through mixed concurrent traffic', async () => {
      const accounts = await makeAccounts(6);
      await Promise.all(accounts.map((account) => fund(account, 5_000n)));

      const totalBefore = (await Promise.all(accounts.map((account) => balanceOf(account)))).reduce(
        (sum, balance) => sum + balance,
        0n,
      );

      const traffic = Array.from({ length: 60 }, () => {
        const from = accounts[Math.floor(Math.random() * accounts.length)]!;
        let to = accounts[Math.floor(Math.random() * accounts.length)]!;
        while (to === from) {
          to = accounts[Math.floor(Math.random() * accounts.length)]!;
        }
        return transfer(from, to, String(500 + Math.floor(Math.random() * 2_000)));
      });

      await Promise.allSettled(traffic);

      const totalAfter = (await Promise.all(accounts.map((account) => balanceOf(account)))).reduce(
        (sum, balance) => sum + balance,
        0n,
      );

      expect(totalAfter).toBe(totalBefore);

      for (const account of accounts) {
        expect(await balanceOf(account)).toBeGreaterThanOrEqual(0n);
      }

      await assertLedgerIntact();
    });
  });
});
