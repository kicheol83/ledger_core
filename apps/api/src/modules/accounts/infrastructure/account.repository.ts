import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import { Account, type AccountStatus, type AccountType } from '../domain/account.js';

interface AccountRow {
  id: string;
  user_id: string | null;
  currency: string;
  type: AccountType;
  status: AccountStatus;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

function toAccount(row: AccountRow): Account {
  return Account.fromPersistence({
    id: row.id,
    userId: row.user_id,
    currency: row.currency,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
  });
}

const ACCOUNT_COLUMNS = 'id, user_id, currency, type, status, created_at';

@Injectable()
export class AccountRepository {
  constructor(private readonly transactions: TransactionManager) {}

  async findById(id: string): Promise<Account | null> {
    const result = await this.transactions.executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }

  async findManyById(ids: string[]): Promise<Account[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.transactions.executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [ids],
    );

    return result.rows.map(toAccount);
  }

  async findByUser(userId: string): Promise<Account[]> {
    const result = await this.transactions.executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );

    return result.rows.map(toAccount);
  }

  async findSystemAccount(currency: string): Promise<Account | null> {
    const result = await this.transactions.executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE type = 'SYSTEM' AND currency = $1`,
      [currency],
    );

    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }

  async create(userId: string, currency: string): Promise<Account> {
    const result = await this.transactions.executor.query<AccountRow>(
      `INSERT INTO accounts (user_id, currency, type)
       VALUES ($1, $2, 'USER')
       RETURNING ${ACCOUNT_COLUMNS}`,
      [userId, currency],
    );

    return toAccount(result.rows[0]!);
  }

  async updateStatus(id: string, status: AccountStatus): Promise<Account | null> {
    const result = await this.transactions.executor.query<AccountRow>(
      `UPDATE accounts SET status = $2 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [id, status],
    );

    const row = result.rows[0];
    return row ? toAccount(row) : null;
  }

  async createUser(email: string): Promise<UserRow> {
    const result = await this.transactions.executor.query<UserRow>(
      `INSERT INTO users (email) VALUES ($1) RETURNING id, email, status, created_at`,
      [email.toLowerCase()],
    );

    return result.rows[0]!;
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const result = await this.transactions.executor.query<UserRow>(
      `SELECT id, email, status, created_at FROM users WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.transactions.executor.query<UserRow>(
      `SELECT id, email, status, created_at FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );

    return result.rows[0] ?? null;
  }
}
