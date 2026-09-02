import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PG_POOL } from '../../src/shared/database/executor.js';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter.js';

describe('Outbox partitioning', () => {
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
    await pool.query('DELETE FROM outbox_events');
    await pool.query('DELETE FROM idempotency_keys');
    await pool.query('SELECT test_reset_ledger()');
    await pool.query(`INSERT INTO accounts (type, currency) VALUES ('SYSTEM', 'UZS')`);
    await pool.query('SELECT ensure_outbox_partitions(3)');
  });

  afterAll(async () => {
    await pool.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT c.relname FROM pg_class c
                   JOIN pg_inherits i ON i.inhrelid = c.oid
                   JOIN pg_class p ON p.oid = i.inhparent
                  WHERE p.relname = 'outbox_events'
                    AND c.relname ~ '^outbox_events_[0-9]{4}_[0-9]{2}$'
        LOOP
          EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
        END LOOP;
      END $$;
    `);
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function partitionNames(): Promise<string[]> {
    const result = await pool.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
         JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'outbox_events'
        ORDER BY c.relname`,
    );
    return result.rows.map((row) => row.relname);
  }

  async function makeAccountAndDeposit(): Promise<string> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`part-${Date.now()}-${Math.random()}@example.test`],
    );
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
      [user.rows[0]!.id],
    );

    const response = await http()
      .post('/deposits')
      .set('idempotency-key', randomUUID())
      .send({ accountId: account.rows[0]!.id, amount: '1000', currency: 'UZS' })
      .expect(201);

    return response.body.id;
  }

  describe('structure', () => {
    it('is a partitioned table', async () => {
      const result = await pool.query<{ relkind: string }>(
        `SELECT relkind FROM pg_class WHERE relname = 'outbox_events'`,
      );

      expect(result.rows[0]!.relkind).toBe('p');
    });

    it('has a default partition', async () => {
      expect(await partitionNames()).toContain('outbox_events_default');
    });

    it('has monthly partitions for the months ahead', async () => {
      const names = await partitionNames();
      const monthly = names.filter((name) => /^outbox_events_\d{4}_\d{2}$/.test(name));

      expect(monthly.length).toBeGreaterThanOrEqual(4);
    });

    it('propagates parent indexes to every partition', async () => {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_index i
           JOIN pg_class idx    ON idx.oid = i.indexrelid
           JOIN pg_class tbl    ON tbl.oid = i.indrelid
           JOIN pg_inherits inh ON inh.inhrelid = tbl.oid
           JOIN pg_class parent ON parent.oid = inh.inhparent
          WHERE parent.relname = 'outbox_events'`,
      );

      expect(Number(result.rows[0]!.count)).toBeGreaterThan(0);
    });
  });

  describe('routing', () => {
    it('writes new events into the current month partition', async () => {
      await makeAccountAndDeposit();

      const current = `outbox_events_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;

      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${current}`,
      );

      expect(Number(result.rows[0]!.count)).toBe(1);
    });

    it('reads through the parent transparently', async () => {
      const transactionId = await makeAccountAndDeposit();

      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox_events WHERE aggregate_id = $1`,
        [transactionId],
      );

      expect(result.rows[0]!.count).toBe('1');
    });

    it('keeps the worker query working across partitions', async () => {
      await makeAccountAndDeposit();
      await makeAccountAndDeposit();

      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM outbox_events
          WHERE status = 'PENDING' AND next_attempt_at <= now()`,
      );

      expect(result.rows[0]!.count).toBe('2');
    });
  });

  describe('pruning', () => {
    it('prunes partitions when the query bounds created_at', async () => {
      await makeAccountAndDeposit();

      const plan = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT * FROM outbox_events
                  WHERE created_at >= date_trunc('month', now())
                    AND created_at < date_trunc('month', now()) + interval '1 month'`,
      );

      const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');

      const scanned = new Set(text.match(/outbox_events_\d{4}_\d{2}/g) ?? []);

      expect(scanned.size).toBeLessThanOrEqual(1);
    });
  });

  describe('management functions', () => {
    it('creates a partition idempotently', async () => {
      const first = await pool.query<{ create_outbox_partition: string }>(
        `SELECT create_outbox_partition('2030-06-15'::date)`,
      );
      const second = await pool.query<{ create_outbox_partition: string }>(
        `SELECT create_outbox_partition('2030-06-01'::date)`,
      );

      expect(first.rows[0]!.create_outbox_partition).toBe('outbox_events_2030_06');
      expect(second.rows[0]!.create_outbox_partition).toBe('outbox_events_2030_06');

      await pool.query('DROP TABLE outbox_events_2030_06');
    });

    it('drops partitions past the retention window', async () => {
      await pool.query(`SELECT create_outbox_partition('2020-01-15'::date)`);

      const dropped = await pool.query<{ partition_name: string; action: string }>(
        `SELECT * FROM drop_old_outbox_partitions(3)`,
      );

      const entry = dropped.rows.find((row) => row.partition_name === 'outbox_events_2020_01');
      expect(entry?.action).toBe('dropped');
      expect(await partitionNames()).not.toContain('outbox_events_2020_01');
    });

    it('keeps a partition holding failed events', async () => {
      await pool.query(`SELECT create_outbox_partition('2020-02-15'::date)`);
      await pool.query(
        `INSERT INTO outbox_events
           (aggregate_type, aggregate_id, event_type, payload, status, last_error, created_at)
         VALUES ('transaction', gen_random_uuid(), 'transfer.completed', '{}',
                 'FAILED', 'endpoint gone', '2020-02-10T00:00:00Z')`,
      );

      const result = await pool.query<{ partition_name: string; action: string }>(
        `SELECT * FROM drop_old_outbox_partitions(3)`,
      );

      const entry = result.rows.find((row) => row.partition_name === 'outbox_events_2020_02');
      expect(entry?.action).toContain('kept');
      expect(await partitionNames()).toContain('outbox_events_2020_02');

      await pool.query('DROP TABLE outbox_events_2020_02');
    });

    it('leaves recent partitions alone', async () => {
      const before = await partitionNames();
      await pool.query(`SELECT drop_old_outbox_partitions(3)`);
      const after = await partitionNames();

      const currentMonth = `outbox_events_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;
      expect(after).toContain(currentMonth);
      expect(after.length).toBeGreaterThanOrEqual(before.length - 1);
    });

    it('never drops the default partition', async () => {
      await pool.query(`SELECT drop_old_outbox_partitions(0)`);
      expect(await partitionNames()).toContain('outbox_events_default');
    });
  });

  describe('constraints survive partitioning', () => {
    it('still rejects a non-object payload', async () => {
      await expect(
        pool.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
           VALUES ('transaction', gen_random_uuid(), 'transfer.completed', '"a string"'::jsonb)`,
        ),
      ).rejects.toThrow(/payload_is_object/);
    });

    it('still ties published_at to the status', async () => {
      await expect(
        pool.query(
          `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, status)
           VALUES ('transaction', gen_random_uuid(), 'transfer.completed', '{}', 'PUBLISHED')`,
        ),
      ).rejects.toThrow(/published_at_matches_status/);
    });
  });
});
