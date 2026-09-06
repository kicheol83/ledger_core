import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import {
  backoffFor,
  EVENT_PUBLISHER,
  OutboxWorker,
} from '../../src/modules/outbox/application/outbox-worker.service';
import { DeliveryError } from '../../src/modules/outbox/infrastructure/webhook.publisher';
import { OutboxModule } from '../../src/modules/outbox/outbox.module';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';

class StubPublisher {
  readonly delivered: string[] = [];
  behaviour: (eventId: string) => void | Promise<void> = () => undefined;

  async publish(event: { id: string }): Promise<void> {
    await this.behaviour(event.id);
    this.delivered.push(event.id);
  }
}

describe('Outbox worker', () => {
  let app: INestApplication;
  let pool: Pool;
  let worker: OutboxWorker;
  let publisher: StubPublisher;

  beforeAll(async () => {
    publisher = new StubPublisher();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, OutboxModule] })
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(publisher)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    pool = app.get<Pool>(PG_POOL);
    worker = app.get(OutboxWorker);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM outbox_events');
    await pool.query('DELETE FROM idempotency_keys');
    await pool.query('SELECT test_reset_ledger()');
    await pool.query(`INSERT INTO accounts (type, currency) VALUES ('SYSTEM', 'UZS')`);

    publisher.delivered.length = 0;
    publisher.behaviour = () => undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function makeAccount(): Promise<string> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`wk-${Date.now()}-${Math.random()}@example.test`],
    );
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
      [user.rows[0]!.id],
    );
    return account.rows[0]!.id;
  }

  async function deposit(accountId: string, amount = '1000'): Promise<string> {
    const response = await http()
      .post('/deposits')
      .set('idempotency-key', randomUUID())
      .send({ accountId, amount, currency: 'UZS' })
      .expect(201);
    return response.body.id;
  }

  async function eventState(transactionId: string): Promise<{
    status: string;
    attempts: number;
    last_error: string | null;
  }> {
    const result = await pool.query<{
      status: string;
      attempts: number;
      last_error: string | null;
    }>(`SELECT status, attempts, last_error FROM outbox_events WHERE aggregate_id = $1`, [
      transactionId,
    ]);
    return result.rows[0]!;
  }

  describe('successful delivery', () => {
    it('publishes a pending event and marks it', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      const summary = await worker.runOnce();

      expect(summary).toMatchObject({ claimed: 1, published: 1 });
      expect(await eventState(transactionId)).toMatchObject({ status: 'PUBLISHED', attempts: 1 });
    });

    it('sets published_at exactly when it publishes', async () => {
      const account = await makeAccount();
      await deposit(account);

      await worker.runOnce();

      const result = await pool.query<{ published_at: string | null }>(
        `SELECT published_at FROM outbox_events`,
      );
      expect(result.rows[0]!.published_at).not.toBeNull();
    });

    it('does not redeliver a published event', async () => {
      const account = await makeAccount();
      await deposit(account);

      await worker.runOnce();
      const second = await worker.runOnce();

      expect(second.claimed).toBe(0);
      expect(publisher.delivered).toHaveLength(1);
    });

    it('drains a batch in id order', async () => {
      const account = await makeAccount();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await deposit(account, '100'));
      }

      await worker.runOnce();

      expect(publisher.delivered).toHaveLength(5);
      const sorted = [...publisher.delivered].sort((a, b) => Number(a) - Number(b));
      expect(publisher.delivered).toEqual(sorted);
    });
  });

  describe('retry', () => {
    it('schedules a retry after a transient failure', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('connection refused', false);
      };

      const summary = await worker.runOnce();

      expect(summary).toMatchObject({ claimed: 1, retried: 1 });
      expect(await eventState(transactionId)).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        last_error: 'connection refused',
      });
    });

    it('does not retry before the backoff has elapsed', async () => {
      const account = await makeAccount();
      await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('connection refused', false);
      };
      await worker.runOnce();

      publisher.behaviour = () => undefined;
      const second = await worker.runOnce();

      expect(second.claimed).toBe(0);
    });

    it('succeeds on a retry once the consumer recovers', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('connection refused', false);
      };
      await worker.runOnce();

      await pool.query(`UPDATE outbox_events SET next_attempt_at = now()`);
      publisher.behaviour = () => undefined;

      const summary = await worker.runOnce();

      expect(summary.published).toBe(1);
      expect(await eventState(transactionId)).toMatchObject({ status: 'PUBLISHED' });
    });

    it('clears the last error on success', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('temporary', false);
      };
      await worker.runOnce();

      await pool.query(`UPDATE outbox_events SET next_attempt_at = now()`);
      publisher.behaviour = () => undefined;
      await worker.runOnce();

      expect((await eventState(transactionId)).last_error).toBeNull();
    });
  });

  describe('dead letters', () => {
    it('gives up immediately on a permanent failure', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('webhook responded 422 Unprocessable Entity', true);
      };

      const summary = await worker.runOnce();

      expect(summary.dead).toBe(1);
      expect(await eventState(transactionId)).toMatchObject({ status: 'FAILED', attempts: 1 });
    });

    it('gives up after the attempt limit on transient failures', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('connection refused', false);
      };

      const maxAttempts = 8;
      for (let i = 0; i < maxAttempts; i += 1) {
        await pool.query(`UPDATE outbox_events SET next_attempt_at = now()`);
        await worker.runOnce();
      }

      const state = await eventState(transactionId);
      expect(state.status).toBe('FAILED');
      expect(state.attempts).toBe(maxAttempts);
    });

    it('leaves dead letters visible rather than deleting them', async () => {
      const account = await makeAccount();
      const transactionId = await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('gone', true);
      };
      await worker.runOnce();

      const state = await eventState(transactionId);
      expect(state.status).toBe('FAILED');
      expect(state.last_error).toBe('gone');
    });

    it('does not reclaim a dead letter on later polls', async () => {
      const account = await makeAccount();
      await deposit(account);

      publisher.behaviour = () => {
        throw new DeliveryError('gone', true);
      };
      await worker.runOnce();

      publisher.behaviour = () => undefined;
      const summary = await worker.runOnce();

      expect(summary.claimed).toBe(0);
    });
  });

  describe('leasing', () => {
    it('holds no transaction open during delivery', async () => {
      const account = await makeAccount();
      await deposit(account);

      let idleInTransaction = 0;

      publisher.behaviour = async () => {
        const result = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM pg_stat_activity
            WHERE state = 'idle in transaction'
              AND application_name = 'ledgercore-api'`,
        );
        idleInTransaction = Number(result.rows[0]!.count);
      };

      await worker.runOnce();

      expect(idleInTransaction).toBe(0);
    });

    it('hides a leased event from a concurrent claim', async () => {
      const account = await makeAccount();
      await deposit(account);

      publisher.behaviour = async () => {
        const result = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM outbox_events
            WHERE status = 'PENDING' AND next_attempt_at <= now()`,
        );
        expect(result.rows[0]!.count).toBe('0');
      };

      await worker.runOnce();
    });
  });

  describe('backoff', () => {
    it('grows exponentially', () => {
      const withoutJitter = (attempt: number): number => {
        const spy = vi.spyOn(Math, 'random').mockReturnValue(1);
        const value = backoffFor(attempt);
        spy.mockRestore();
        return value;
      };

      expect(withoutJitter(1)).toBe(1_000);
      expect(withoutJitter(2)).toBe(2_000);
      expect(withoutJitter(3)).toBe(4_000);
      expect(withoutJitter(8)).toBe(128_000);
    });

    it('caps at an hour', () => {
      expect(backoffFor(30)).toBeLessThanOrEqual(3_600_000);
    });

    it('applies jitter', () => {
      const samples = new Set(Array.from({ length: 20 }, () => backoffFor(5)));
      expect(samples.size).toBeGreaterThan(1);
    });

    it('never returns a negative delay', () => {
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        expect(backoffFor(attempt)).toBeGreaterThan(0);
      }
    });
  });

  describe('lifecycle', () => {
    it('reports an empty batch when nothing is due', async () => {
      const summary = await worker.runOnce();
      expect(summary).toEqual({ claimed: 0, published: 0, retried: 0, dead: 0 });
    });

    it('stops cleanly', async () => {
      await expect(worker.stop()).resolves.toBeUndefined();
    });
  });
});
