import type { PoolClient } from 'pg';
import { query } from './db.js';

let sequence = 0;

function uniqueEmail(): string {
  sequence += 1;
  return `user${sequence}.${Date.now()}@example.test`;
}

export async function createUser(): Promise<string> {
  const result = await query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [
    uniqueEmail(),
  ]);
  return result.rows[0]!.id;
}

export async function createAccount(currency = 'UZS'): Promise<string> {
  const userId = await createUser();
  const result = await query<{ id: string }>(
    'INSERT INTO accounts (user_id, currency) VALUES ($1, $2) RETURNING id',
    [userId, currency],
  );
  return result.rows[0]!.id;
}

export async function createSystemAccount(currency = 'UZS'): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO accounts (type, currency) VALUES ('SYSTEM', $1) RETURNING id`,
    [currency],
  );
  return result.rows[0]!.id;
}

export interface EntrySpec {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;
}

export interface TransactionSpec {
  type?: 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL' | 'REVERSAL';
  status?: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  amount: bigint;
  currency?: string;
  reversesId?: string;
  entries: EntrySpec[];
}

export async function writeTransaction(client: PoolClient, spec: TransactionSpec): Promise<string> {
  const status = spec.status ?? 'COMPLETED';

  const result = await client.query<{ id: string }>(
    `INSERT INTO transactions (type, status, amount, currency, reverses_id, completed_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $2 = 'PENDING' THEN NULL ELSE now() END)
     RETURNING id`,
    [
      spec.type ?? 'TRANSFER',
      status,
      spec.amount.toString(),
      spec.currency ?? 'UZS',
      spec.reversesId ?? null,
    ],
  );

  const transactionId = result.rows[0]!.id;

  for (const entry of spec.entries) {
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
       VALUES ($1, $2, $3, $4)`,
      [transactionId, entry.accountId, entry.direction, entry.amount.toString()],
    );
  }

  return transactionId;
}

export function transfer(from: string, to: string, amount: bigint): EntrySpec[] {
  return [
    { accountId: from, direction: 'DEBIT', amount },
    { accountId: to, direction: 'CREDIT', amount },
  ];
}

export async function balanceOf(accountId: string): Promise<bigint> {
  const result = await query<{ balance: string }>(
    `SELECT coalesce(
              sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END),
              0
            )::text AS balance
       FROM ledger_entries
      WHERE account_id = $1`,
    [accountId],
  );
  return BigInt(result.rows[0]!.balance);
}

export async function integrityViolations(): Promise<
  Array<{ transaction_id: string; violation: string; detail: string }>
> {
  const result = await query<{ transaction_id: string; violation: string; detail: string }>(
    'SELECT * FROM verify_ledger_integrity()',
  );
  return result.rows;
}
