import { Money } from '../../../shared/money/index.js';

export const ENTRY_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const TRANSACTION_TYPES = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'REVERSAL'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export class UnbalancedEntriesError extends Error {
  constructor(debits: Money, credits: Money) {
    super(`entries do not balance: debits ${debits.toString()}, credits ${credits.toString()}`);
    this.name = 'UnbalancedEntriesError';
  }
}

export interface LedgerEntry {
  readonly accountId: string;
  readonly direction: EntryDirection;
  readonly amount: Money;
}

export class BalancedEntries {
  private constructor(
    readonly entries: readonly LedgerEntry[],
    readonly total: Money,
  ) {}

  static of(entries: LedgerEntry[]): BalancedEntries {
    if (entries.length < 2) {
      throw new UnbalancedEntriesError(
        Money.zero(entries[0]?.amount.currency.code ?? 'UZS'),
        Money.zero(entries[0]?.amount.currency.code ?? 'UZS'),
      );
    }

    const currency = entries[0]!.amount.currency.code;
    let debits = Money.zero(currency);
    let credits = Money.zero(currency);

    for (const entry of entries) {
      if (!entry.amount.isPositive) {
        throw new UnbalancedEntriesError(debits, credits);
      }

      if (entry.direction === 'DEBIT') {
        debits = debits.plus(entry.amount);
      } else {
        credits = credits.plus(entry.amount);
      }
    }

    if (!debits.equals(credits)) {
      throw new UnbalancedEntriesError(debits, credits);
    }

    return new BalancedEntries(Object.freeze([...entries]), debits);
  }

  get accountIds(): string[] {
    return [...new Set(this.entries.map((entry) => entry.accountId))].sort();
  }

  netFor(accountId: string): Money {
    return this.entries
      .filter((entry) => entry.accountId === accountId)
      .reduce(
        (net, entry) =>
          entry.direction === 'CREDIT' ? net.plus(entry.amount) : net.minus(entry.amount),
        Money.zero(this.total.currency.code),
      );
  }

  reversed(): BalancedEntries {
    return BalancedEntries.of(
      this.entries.map((entry) => ({
        accountId: entry.accountId,
        direction: entry.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
        amount: entry.amount,
      })),
    );
  }
}

export function simpleTransfer(from: string, to: string, amount: Money): BalancedEntries {
  return BalancedEntries.of([
    { accountId: from, direction: 'DEBIT', amount },
    { accountId: to, direction: 'CREDIT', amount },
  ]);
}
