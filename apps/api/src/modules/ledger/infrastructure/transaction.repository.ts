import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager';
import { Money } from '../../../shared/money/index';
import type { AccountStatus } from '../../accounts/domain/account';
import type { BalancedEntries, TransactionStatus, TransactionType } from '../domain/ledger-entry';

export interface LockedAccount {
  id: string;
  currency: string;
  status: AccountStatus;
  type: 'USER' | 'SYSTEM';
}

export interface PersistedTransaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  reversesId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

interface TransactionRow {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  reverses_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface EntryRow {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  created_at: string;
}

function toTransaction(row: TransactionRow): PersistedTransaction {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    reversesId: row.reverses_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const TRANSACTION_COLUMNS =
  'id, type, status, amount, currency, reverses_id, metadata, created_at, completed_at';

@Injectable()
export class TransactionRepository {
  constructor(private readonly transactions: TransactionManager) {}

  async lockAccounts(accountIds: string[]): Promise<LockedAccount[]> {
    if (!this.transactions.inTransaction) {
      throw new Error('lockAccounts() must be called inside a transaction');
    }

    const result = await this.transactions.executor.query<LockedAccount>(
      `SELECT id, currency, status, type
         FROM accounts
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR UPDATE`,
      [[...accountIds].sort()],
    );

    return result.rows;
  }

  async insertTransaction(params: {
    type: TransactionType;
    status: TransactionStatus;
    amount: Money;
    reversesId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<PersistedTransaction> {
    const result = await this.transactions.executor.query<TransactionRow>(
      `INSERT INTO transactions (type, status, amount, currency, reverses_id, metadata, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $2 = 'PENDING' THEN NULL ELSE now() END)
       RETURNING ${TRANSACTION_COLUMNS}`,
      [
        params.type,
        params.status,
        params.amount.toDatabaseValue(),
        params.amount.currency.code,
        params.reversesId ?? null,
        JSON.stringify(params.metadata ?? {}),
      ],
    );

    return toTransaction(result.rows[0]!);
  }

  async insertEntries(transactionId: string, entries: BalancedEntries): Promise<void> {
    const accountIds = entries.entries.map((entry) => entry.accountId);
    const directions = entries.entries.map((entry) => entry.direction);
    const amounts = entries.entries.map((entry) => entry.amount.toDatabaseValue());

    await this.transactions.executor.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
       SELECT $1::uuid, account_id, direction::entry_direction, amount::bigint
         FROM unnest($2::uuid[], $3::text[], $4::text[])
              AS t(account_id, direction, amount)`,
      [transactionId, accountIds, directions, amounts],
    );
  }

  async findById(id: string): Promise<PersistedTransaction | null> {
    const result = await this.transactions.executor.query<TransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? toTransaction(row) : null;
  }

  async markReversed(id: string): Promise<void> {
    await this.transactions.executor.query(
      `UPDATE transactions SET status = 'REVERSED' WHERE id = $1 AND status = 'COMPLETED'`,
      [id],
    );
  }

  async findEntries(transactionId: string): Promise<EntryRow[]> {
    const result = await this.transactions.executor.query<EntryRow>(
      `SELECT id, transaction_id, account_id, direction, amount, created_at
         FROM ledger_entries
        WHERE transaction_id = $1
        ORDER BY id`,
      [transactionId],
    );

    return result.rows;
  }

  async findByAccount(
    accountId: string,
    options: { limit: number; beforeEntryId?: string },
  ): Promise<Array<PersistedTransaction & { entryId: string; direction: string }>> {
    const result = await this.transactions.executor.query<
      TransactionRow & { entry_id: string; direction: string }
    >(
      `SELECT t.id, t.type, t.status, t.amount, t.currency, t.reverses_id,
              t.metadata, t.created_at, t.completed_at,
              e.id::text AS entry_id, e.direction
         FROM ledger_entries e
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1
          AND ($2::bigint IS NULL OR e.id < $2::bigint)
        ORDER BY e.id DESC
        LIMIT $3`,
      [accountId, options.beforeEntryId ?? null, options.limit],
    );

    return result.rows.map((row) => ({
      ...toTransaction(row),
      entryId: row.entry_id,
      direction: row.direction,
    }));
  }
}
