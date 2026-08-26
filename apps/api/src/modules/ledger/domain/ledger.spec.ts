import { describe, expect, it } from 'vitest';
import { InsufficientFundsError } from '../../../shared/errors/ledger.errors.js';
import { CurrencyMismatchError } from '../../../shared/errors/ledger.errors.js';
import { Money } from '../../../shared/money/index.js';
import { Balance } from './balance.js';
import { BalancedEntries, simpleTransfer, UnbalancedEntriesError } from './ledger-entry.js';

const uzs = (amount: bigint): Money => Money.fromMinorUnits(amount, 'UZS');

describe('BalancedEntries', () => {
  it('accepts a two-entry transfer', () => {
    const entries = simpleTransfer('acc-a', 'acc-b', uzs(5_000n));

    expect(entries.entries).toHaveLength(2);
    expect(entries.total.minorUnits).toBe(5_000n);
  });

  it('accepts a split across three entries', () => {
    const entries = BalancedEntries.of([
      { accountId: 'source', direction: 'DEBIT', amount: uzs(10_000n) },
      { accountId: 'recipient', direction: 'CREDIT', amount: uzs(9_500n) },
      { accountId: 'fees', direction: 'CREDIT', amount: uzs(500n) },
    ]);

    expect(entries.total.minorUnits).toBe(10_000n);
  });

  it('rejects entries that do not balance', () => {
    expect(() =>
      BalancedEntries.of([
        { accountId: 'a', direction: 'DEBIT', amount: uzs(5_000n) },
        { accountId: 'b', direction: 'CREDIT', amount: uzs(4_999n) },
      ]),
    ).toThrow(UnbalancedEntriesError);
  });

  it('rejects a single entry', () => {
    expect(() =>
      BalancedEntries.of([{ accountId: 'a', direction: 'CREDIT', amount: uzs(5_000n) }]),
    ).toThrow(UnbalancedEntriesError);
  });

  it('rejects a zero or negative amount', () => {
    expect(() =>
      BalancedEntries.of([
        { accountId: 'a', direction: 'DEBIT', amount: uzs(0n) },
        { accountId: 'b', direction: 'CREDIT', amount: uzs(0n) },
      ]),
    ).toThrow(UnbalancedEntriesError);
  });

  it('rejects mixed currencies', () => {
    expect(() =>
      BalancedEntries.of([
        { accountId: 'a', direction: 'DEBIT', amount: uzs(5_000n) },
        { accountId: 'b', direction: 'CREDIT', amount: Money.fromMinorUnits(5_000n, 'KRW') },
      ]),
    ).toThrow(CurrencyMismatchError);
  });

  it('is frozen after construction', () => {
    const entries = simpleTransfer('a', 'b', uzs(5_000n));

    expect(() => {
      (entries.entries as unknown as unknown[]).push({});
    }).toThrow();
  });

  describe('accountIds', () => {
    it('returns them sorted, which is the lock order', () => {
      const entries = simpleTransfer('zzz', 'aaa', uzs(100n));

      expect(entries.accountIds).toEqual(['aaa', 'zzz']);
    });

    it('deduplicates an account appearing on both sides', () => {
      const entries = BalancedEntries.of([
        { accountId: 'a', direction: 'DEBIT', amount: uzs(100n) },
        { accountId: 'b', direction: 'CREDIT', amount: uzs(60n) },
        { accountId: 'a', direction: 'CREDIT', amount: uzs(40n) },
      ]);

      expect(entries.accountIds).toEqual(['a', 'b']);
    });
  });

  describe('netFor', () => {
    it('is negative for the debited account', () => {
      const entries = simpleTransfer('a', 'b', uzs(5_000n));

      expect(entries.netFor('a').minorUnits).toBe(-5_000n);
      expect(entries.netFor('b').minorUnits).toBe(5_000n);
    });

    it('nets an account that appears on both sides', () => {
      const entries = BalancedEntries.of([
        { accountId: 'a', direction: 'DEBIT', amount: uzs(100n) },
        { accountId: 'b', direction: 'CREDIT', amount: uzs(60n) },
        { accountId: 'a', direction: 'CREDIT', amount: uzs(40n) },
      ]);

      expect(entries.netFor('a').minorUnits).toBe(-60n);
    });
  });

  describe('reversed', () => {
    it('mirrors every direction', () => {
      const reversal = simpleTransfer('a', 'b', uzs(5_000n)).reversed();

      expect(reversal.netFor('a').minorUnits).toBe(5_000n);
      expect(reversal.netFor('b').minorUnits).toBe(-5_000n);
    });

    it('nets to zero when applied on top of the original', () => {
      const original = simpleTransfer('a', 'b', uzs(5_000n));
      const reversal = original.reversed();

      expect(original.netFor('a').plus(reversal.netFor('a')).isZero).toBe(true);
    });
  });
});

describe('Balance', () => {
  it('covers an amount it is equal to', () => {
    const balance = new Balance('acc-1', uzs(5_000n), '10', 2);

    expect(balance.covers(uzs(5_000n))).toBe(true);
    expect(balance.covers(uzs(5_001n))).toBe(false);
  });

  it('throws with the shortfall when it does not cover', () => {
    const balance = new Balance('acc-1', uzs(1_000n), '10', 2);

    try {
      balance.assertCovers(uzs(5_000n));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFundsError);
      expect((error as InsufficientFundsError).details['shortfall']).toBe('4000');
    }
  });

  it('treats a negative balance as covering nothing', () => {
    const balance = new Balance('acc-1', uzs(-500n), '10', 2);

    expect(balance.covers(uzs(1n))).toBe(false);
  });

  it('starts empty with a null watermark', () => {
    const balance = Balance.empty('acc-1', 'UZS');

    expect(balance.amount.isZero).toBe(true);
    expect(balance.asOfEntryId).toBeNull();
    expect(balance.entryCount).toBe(0);
  });

  it('serialises the amount as a string', () => {
    const balance = new Balance('acc-1', Money.fromMinorUnits('9007199254740993', 'UZS'), '1', 1);

    expect(balance.toJSON().amount).toBe('9007199254740993');
  });
});
