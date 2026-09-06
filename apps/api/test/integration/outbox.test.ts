import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { OutboxRepository } from '../../src/modules/outbox/infrastructure/outbox.repository';
import { TransactionManager } from '../../src/shared/database/transaction.manager';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';

describe('Outbox emission', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function makeAccount(): Promise<string> {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`ob-${Date.now()}-${Math.random()}@example.test`],
    );
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
      [user.rows[0]!.id],
    );
    return account.rows[0]!.id;
  }

  async function deposit(accountId: string, amount: string): Promise<string> {
    const response = await http()
      .post('/deposits')
      .set('idempotency-key', randomUUID())
      .send({ accountId, amount, currency: 'UZS' })
      .expect(201);
    return response.body.id;
  }

  async function eventsFor(
    transactionId: string,
  ): Promise<Array<{ event_type: string; payload: Record<string, unknown>; status: string }>> {
    const result = await pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
      status: string;
    }>(`SELECT event_type, payload, status FROM outbox_events WHERE aggregate_id = $1`, [
      transactionId,
    ]);
    return result.rows;
  }

  describe('emission', () => {
    it('writes one event per transfer', async () => {
      const from = await makeAccount();
      const to = await makeAccount();
      await deposit(from, '10000');

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: from, toAccountId: to, amount: '3000', currency: 'UZS' })
        .expect(201);

      const events = await eventsFor(response.body.id);

      expect(events).toHaveLength(1);
      expect(events[0]!.event_type).toBe('transfer.completed');
      expect(events[0]!.status).toBe('PENDING');
    });

    it('emits the right type for each operation', async () => {
      const account = await makeAccount();
      const depositId = await deposit(account, '10000');

      const withdrawal = await http()
        .post('/withdrawals')
        .set('idempotency-key', randomUUID())
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      const reversal = await http()
        .post(`/transactions/${withdrawal.body.id}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({ reason: 'test' })
        .expect(201);

      expect((await eventsFor(depositId))[0]!.event_type).toBe('deposit.completed');
      expect((await eventsFor(withdrawal.body.id))[0]!.event_type).toBe('withdrawal.completed');
      expect((await eventsFor(reversal.body.id))[0]!.event_type).toBe('transaction.reversed');
    });

    it('carries both sides of the movement in the payload', async () => {
      const from = await makeAccount();
      const to = await makeAccount();
      await deposit(from, '10000');

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: from, toAccountId: to, amount: '3000', currency: 'UZS' })
        .expect(201);

      const payload = (await eventsFor(response.body.id))[0]!.payload as {
        entries: Array<{ accountId: string; direction: string; amount: string }>;
        amount: string;
        currency: string;
      };

      expect(payload.amount).toBe('3000');
      expect(payload.currency).toBe('UZS');
      expect(payload.entries).toHaveLength(2);
      expect(payload.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: from, direction: 'DEBIT', amount: '3000' }),
          expect.objectContaining({ accountId: to, direction: 'CREDIT', amount: '3000' }),
        ]),
      );
    });

    it('serialises amounts as strings', async () => {
      const account = await makeAccount();
      const id = await deposit(account, '9007199254740993');

      const payload = (await eventsFor(id))[0]!.payload as { amount: string };

      expect(payload.amount).toBe('9007199254740993');
      expect(typeof payload.amount).toBe('string');
    });

    it('includes no balance', async () => {
      const account = await makeAccount();
      const id = await deposit(account, '5000');

      const payload = (await eventsFor(id))[0]!.payload;

      expect(payload).not.toHaveProperty('balance');
    });

    it('links a reversal event back to the original', async () => {
      const account = await makeAccount();
      const depositId = await deposit(account, '5000');

      const reversal = await http()
        .post(`/transactions/${depositId}/reversal`)
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(201);

      const payload = (await eventsFor(reversal.body.id))[0]!.payload as { reversesId: string };
      expect(payload.reversesId).toBe(depositId);
    });

    it('propagates metadata', async () => {
      const from = await makeAccount();
      const to = await makeAccount();
      await deposit(from, '10000');

      const response = await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({
          fromAccountId: from,
          toAccountId: to,
          amount: '100',
          currency: 'UZS',
          metadata: { orderId: 'ORD-7' },
        })
        .expect(201);

      const payload = (await eventsFor(response.body.id))[0]!.payload as {
        metadata: Record<string, string>;
      };
      expect(payload.metadata.orderId).toBe('ORD-7');
    });
  });

  describe('atomicity', () => {
    it('emits no event when the operation fails', async () => {
      const from = await makeAccount();
      const to = await makeAccount();
      await deposit(from, '1000');

      const before = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox_events`,
      );

      await http()
        .post('/transfers')
        .set('idempotency-key', randomUUID())
        .send({ fromAccountId: from, toAccountId: to, amount: '5000', currency: 'UZS' })
        .expect(422);

      const after = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox_events`,
      );

      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    });

    it('emits no second event for an idempotent replay', async () => {
      const account = await makeAccount();
      const key = randomUUID();

      const first = await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      await http()
        .post('/deposits')
        .set('idempotency-key', key)
        .send({ accountId: account, amount: '1000', currency: 'UZS' })
        .expect(201);

      expect(await eventsFor(first.body.id)).toHaveLength(1);
    });

    it('refuses to emit outside a transaction', async () => {
      const repository = app.get(OutboxRepository);

      await expect(
        repository.emit({
          aggregateType: 'transaction',
          aggregateId: '00000000-0000-0000-0000-000000000000',
          eventType: 'transfer.completed',
          payload: {},
        }),
      ).rejects.toThrow(/inside the transaction/);
    });
  });

  describe('claiming', () => {
    it('hands disjoint batches to concurrent workers', async () => {
      const account = await makeAccount();
      for (let i = 0; i < 6; i += 1) {
        await deposit(account, '100');
      }

      const repository = app.get(OutboxRepository);
      const manager = app.get(TransactionManager);

      let firstBatch: string[] = [];
      let secondBatch: string[] = [];

      await manager.run(async () => {
        firstBatch = (await repository.claimDue(3)).map((event) => event.id);

        const other = await pool.connect();
        try {
          await other.query('BEGIN');
          const result = await other.query<{ id: string }>(
            `SELECT id::text FROM outbox_events
              WHERE status = 'PENDING' AND next_attempt_at <= now()
              ORDER BY next_attempt_at, id LIMIT 3
                FOR UPDATE SKIP LOCKED`,
          );
          secondBatch = result.rows.map((row) => row.id);
          await other.query('ROLLBACK');
        } finally {
          other.release();
        }
      });

      expect(firstBatch).toHaveLength(3);
      expect(secondBatch).toHaveLength(3);
      expect(firstBatch.some((id) => secondBatch.includes(id))).toBe(false);
    });

    it('skips events whose next attempt is in the future', async () => {
      const account = await makeAccount();
      await deposit(account, '100');

      await pool.query(`UPDATE outbox_events SET next_attempt_at = now() + interval '1 hour'`);

      const repository = app.get(OutboxRepository);
      const manager = app.get(TransactionManager);

      const claimed = await manager.run(async () => repository.claimDue(10));

      expect(claimed).toHaveLength(0);
    });
  });

  describe('retention', () => {
    it('purges published events older than the cutoff', async () => {
      const account = await makeAccount();
      await deposit(account, '100');

      await pool.query(
        `UPDATE outbox_events
            SET status = 'PUBLISHED', published_at = now() - interval '30 days'`,
      );

      const purged = await pool.query<{ purge_published_outbox_events: number }>(
        `SELECT purge_published_outbox_events(interval '7 days', 100)`,
      );

      expect(purged.rows[0]!.purge_published_outbox_events).toBeGreaterThanOrEqual(1);
    });

    it('never purges failed events', async () => {
      const account = await makeAccount();
      await deposit(account, '100');

      await pool.query(
        `UPDATE outbox_events SET status = 'FAILED', last_error = 'endpoint unreachable'`,
      );

      await pool.query(`SELECT purge_published_outbox_events(interval '1 second', 100)`);

      const remaining = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox_events WHERE status = 'FAILED'`,
      );
      expect(remaining.rows[0]!.count).toBe('1');
    });
  });
});
