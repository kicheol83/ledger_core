import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';

export interface IdempotencyRecord {
  key: string;
  endpoint: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  transactionId: string | null;
}

interface IdempotencyRow {
  key: string;
  endpoint: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  transaction_id: string | null;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    key: row.key,
    endpoint: row.endpoint,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    transactionId: row.transaction_id,
  };
}

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly transactions: TransactionManager) {}

  async claim(params: {
    key: string;
    endpoint: string;
    requestHash: string;
    ttlHours: number;
  }): Promise<boolean> {
    const result = await this.transactions.executor.query(
      `INSERT INTO idempotency_keys (key, endpoint, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4::int))
       ON CONFLICT (key) DO NOTHING`,
      [params.key, params.endpoint, params.requestHash, params.ttlHours],
    );

    return result.rowCount === 1;
  }

  async find(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.transactions.executor.query<IdempotencyRow>(
      `SELECT key, endpoint, request_hash, response_status, response_body, transaction_id
         FROM idempotency_keys
        WHERE key = $1`,
      [key],
    );

    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async recordResponse(params: {
    key: string;
    status: number;
    body: unknown;
    transactionId: string | null;
  }): Promise<void> {
    await this.transactions.executor.query(
      `UPDATE idempotency_keys
          SET response_status = $2, response_body = $3, transaction_id = $4
        WHERE key = $1`,
      [params.key, params.status, JSON.stringify(params.body), params.transactionId],
    );
  }

  async purgeExpired(limit = 10_000): Promise<number> {
    const result = await this.transactions.executor.query<{
      purge_expired_idempotency_keys: number;
    }>('SELECT purge_expired_idempotency_keys($1)', [limit]);

    return result.rows[0]!.purge_expired_idempotency_keys;
  }
}
