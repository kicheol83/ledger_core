import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import type { OutboxEventInput } from '../domain/event.js';

export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  publishedAt: string | null;
}

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  last_error: string | null;
  created_at: string;
  published_at: string | null;
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

const COLUMNS = `id::text, aggregate_type, aggregate_id, event_type, payload,
                 status, attempts, last_error, created_at, published_at`;

function columnsFor(alias: string): string {
  return COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly transactions: TransactionManager) {}

  async emit(event: OutboxEventInput): Promise<string> {
    if (!this.transactions.inTransaction) {
      throw new Error(
        'outbox events must be emitted inside the transaction that produces them; ' +
          'emitting outside one recreates the dual write this pattern removes',
      );
    }

    const result = await this.transactions.executor.query<{ id: string }>(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text`,
      [event.aggregateType, event.aggregateId, event.eventType, JSON.stringify(event.payload)],
    );

    return result.rows[0]!.id;
  }

  async claimDue(limit: number): Promise<OutboxEvent[]> {
    if (!this.transactions.inTransaction) {
      throw new Error('claimDue() must be called inside a transaction to hold its locks');
    }

    const result = await this.transactions.executor.query<OutboxRow>(
      `SELECT ${COLUMNS}
         FROM outbox_events
        WHERE status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at, id
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );

    return result.rows.map(toEvent);
  }

  async leaseDue(limit: number, leaseMs: number): Promise<OutboxEvent[]> {
    const result = await this.transactions.executor.query<OutboxRow>(
      `WITH due AS (
         SELECT id
           FROM outbox_events
          WHERE status = 'PENDING'
            AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          LIMIT $1
            FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events e
          SET next_attempt_at = now() + make_interval(secs => $2::numeric / 1000)
         FROM due
        WHERE e.id = due.id
       RETURNING ${columnsFor('e')}`,
      [limit, leaseMs],
    );

    return result.rows.map(toEvent);
  }

  async markPublished(id: string): Promise<void> {
    await this.transactions.executor.query(
      `UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE id = $1::bigint`,
      [id],
    );
  }

  async markFailed(params: {
    id: string;
    error: string;
    backoffMs: number;
    dead: boolean;
  }): Promise<void> {
    await this.transactions.executor.query(
      `UPDATE outbox_events
          SET status = CASE WHEN $4 THEN 'FAILED' ELSE 'PENDING' END,
              attempts = attempts + 1,
              last_error = left($2, 1000),
              next_attempt_at = now() + make_interval(secs => $3::numeric / 1000)
        WHERE id = $1::bigint`,
      [params.id, params.error, params.backoffMs, params.dead],
    );
  }

  async list(options: {
    status?: 'PENDING' | 'PUBLISHED' | 'FAILED';
    limit: number;
    beforeId?: string;
  }): Promise<OutboxEvent[]> {
    const result = await this.transactions.executor.query<OutboxRow>(
      `SELECT ${COLUMNS}
         FROM outbox_events
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::bigint IS NULL OR id < $2::bigint)
        ORDER BY id DESC
        LIMIT $3`,
      [options.status ?? null, options.beforeId ?? null, options.limit],
    );

    return result.rows.map(toEvent);
  }

  async findByAggregate(aggregateId: string): Promise<OutboxEvent[]> {
    const result = await this.transactions.executor.query<OutboxRow>(
      `SELECT ${COLUMNS} FROM outbox_events WHERE aggregate_id = $1 ORDER BY id`,
      [aggregateId],
    );

    return result.rows.map(toEvent);
  }

  async stats(): Promise<{
    pending: number;
    published: number;
    failed: number;
    oldestPendingAgeSeconds: number | null;
  }> {
    const result = await this.transactions.executor.query<{
      pending: string;
      published: string;
      failed: string;
      oldest_pending_age: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'PENDING')::text   AS pending,
         count(*) FILTER (WHERE status = 'PUBLISHED')::text AS published,
         count(*) FILTER (WHERE status = 'FAILED')::text    AS failed,
         extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'PENDING'))::text
           AS oldest_pending_age
       FROM outbox_events`,
    );

    const row = result.rows[0]!;

    return {
      pending: Number(row.pending),
      published: Number(row.published),
      failed: Number(row.failed),

      oldestPendingAgeSeconds: row.oldest_pending_age ? Number(row.oldest_pending_age) : null,
    };
  }
}
