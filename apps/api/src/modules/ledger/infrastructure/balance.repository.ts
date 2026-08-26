import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import { Money } from '../../../shared/money/index.js';
import { Balance } from '../domain/balance.js';

interface BalanceRow {
  account_id: string;
  balance: string;
  as_of_entry_id: string | null;
  entry_count: string;
}

const BALANCE_EXPRESSION = `
  coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)::text
    AS balance,
  max(id)::text   AS as_of_entry_id,
  count(*)::text  AS entry_count
`;

@Injectable()
export class BalanceRepository {
  constructor(private readonly transactions: TransactionManager) {}

  async balanceOf(accountId: string, currency: string): Promise<Balance> {
    const result = await this.transactions.executor.query<BalanceRow>(
      `SELECT $1::uuid AS account_id, ${BALANCE_EXPRESSION}
         FROM ledger_entries
        WHERE account_id = $1`,
      [accountId],
    );

    return toBalance(result.rows[0]!, accountId, currency);
  }

  async balancesOf(
    accounts: Array<{ id: string; currency: string }>,
  ): Promise<Map<string, Balance>> {
    if (accounts.length === 0) {
      return new Map();
    }

    const ids = accounts.map((account) => account.id);

    const result = await this.transactions.executor.query<BalanceRow>(
      `SELECT account_id, ${BALANCE_EXPRESSION}
         FROM ledger_entries
        WHERE account_id = ANY($1::uuid[])
        GROUP BY account_id`,
      [ids],
    );

    const balances = new Map<string, Balance>();

    for (const row of result.rows) {
      const currency = accounts.find((account) => account.id === row.account_id)?.currency;
      if (currency) {
        balances.set(row.account_id, toBalance(row, row.account_id, currency));
      }
    }

    for (const account of accounts) {
      if (!balances.has(account.id)) {
        balances.set(account.id, Balance.empty(account.id, account.currency));
      }
    }

    return balances;
  }

  async balanceAsOf(accountId: string, currency: string, entryId: string): Promise<Balance> {
    const result = await this.transactions.executor.query<BalanceRow>(
      `SELECT $1::uuid AS account_id, ${BALANCE_EXPRESSION}
         FROM ledger_entries
        WHERE account_id = $1 AND id <= $2::bigint`,
      [accountId, entryId],
    );

    return toBalance(result.rows[0]!, accountId, currency);
  }

  async systemImbalance(currency: string): Promise<Money> {
    const result = await this.transactions.executor.query<{ imbalance: string }>(
      `SELECT coalesce(
                sum(CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END),
                0
              )::text AS imbalance
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE a.currency = $1`,
      [currency],
    );

    return Money.fromMinorUnits(result.rows[0]!.imbalance, currency);
  }
}

function toBalance(row: BalanceRow, accountId: string, currency: string): Balance {
  return new Balance(
    accountId,
    Money.fromMinorUnits(row.balance, currency),
    row.as_of_entry_id,
    Number(row.entry_count),
  );
}
