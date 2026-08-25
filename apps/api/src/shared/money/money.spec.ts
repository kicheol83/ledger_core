import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError } from '../errors/ledger.errors.js';
import { UnknownCurrencyError } from './currency.js';
import { InvalidMoneyError, Money } from './money.js';

const uzs = (amount: bigint): Money => Money.fromMinorUnits(amount, 'UZS');
const krw = (amount: bigint): Money => Money.fromMinorUnits(amount, 'KRW');

describe('Money construction', () => {
  it('rejects an unknown currency', () => {
    expect(() => Money.fromMinorUnits(100n, 'XYZ')).toThrow(UnknownCurrencyError);
  });

  it('accepts minor units as a string', () => {
    expect(Money.fromMinorUnits('1050', 'USD').minorUnits).toBe(1050n);
  });

  it('rejects a malformed minor-unit string', () => {
    expect(() => Money.fromMinorUnits('10.50', 'USD')).toThrow(InvalidMoneyError);
    expect(() => Money.fromMinorUnits('abc', 'USD')).toThrow(InvalidMoneyError);
  });

  it('preserves values above Number.MAX_SAFE_INTEGER', () => {
    const money = Money.fromMinorUnits('9007199254740993', 'UZS');
    expect(money.minorUnits).toBe(9_007_199_254_740_993n);
    expect(money.toDatabaseValue()).toBe('9007199254740993');
  });

  describe('fromDecimal', () => {
    it('scales by the currency exponent', () => {
      expect(Money.fromDecimal('10.50', 'USD').minorUnits).toBe(1050n);
      expect(Money.fromDecimal('10.5', 'USD').minorUnits).toBe(1050n);
      expect(Money.fromDecimal('10', 'USD').minorUnits).toBe(1000n);
    });

    it('handles zero-exponent currencies without scaling', () => {
      expect(Money.fromDecimal('1000', 'KRW').minorUnits).toBe(1000n);
    });

    it('rejects more precision than the currency has', () => {
      expect(() => Money.fromDecimal('10.505', 'USD')).toThrow(/2 decimal places/);
      expect(() => Money.fromDecimal('1000.5', 'KRW')).toThrow(/0 decimal places/);
    });

    it('handles negative amounts', () => {
      expect(Money.fromDecimal('-10.50', 'USD').minorUnits).toBe(-1050n);
    });

    it('rejects non-numeric input', () => {
      expect(() => Money.fromDecimal('ten', 'USD')).toThrow(InvalidMoneyError);
      expect(() => Money.fromDecimal('', 'USD')).toThrow(InvalidMoneyError);
      expect(() => Money.fromDecimal('1,050.00', 'USD')).toThrow(InvalidMoneyError);
    });

    it('avoids the float representation problem entirely', () => {
      const sum = Money.fromDecimal('0.10', 'USD').plus(Money.fromDecimal('0.20', 'USD'));
      expect(sum.equals(Money.fromDecimal('0.30', 'USD'))).toBe(true);
    });
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts', () => {
    expect(uzs(1_000n).plus(uzs(500n)).minorUnits).toBe(1_500n);
    expect(uzs(1_000n).minus(uzs(500n)).minorUnits).toBe(500n);
  });

  it('allows a negative result', () => {
    expect(uzs(100n).minus(uzs(500n)).minorUnits).toBe(-400n);
  });

  it('refuses arithmetic across currencies', () => {
    expect(() => uzs(1_000n).plus(krw(1_000n))).toThrow(CurrencyMismatchError);
    expect(() => uzs(1_000n).minus(krw(1_000n))).toThrow(CurrencyMismatchError);
    expect(() => uzs(1_000n).isGreaterThan(krw(1_000n))).toThrow(CurrencyMismatchError);
  });

  it('is immutable', () => {
    const original = uzs(1_000n);
    original.plus(uzs(500n));
    expect(original.minorUnits).toBe(1_000n);
  });

  it('multiplies by whole numbers', () => {
    expect(uzs(1_000n).times(3).minorUnits).toBe(3_000n);
    expect(uzs(1_000n).times(3n).minorUnits).toBe(3_000n);
  });

  it('refuses fractional multiplication', () => {
    expect(() => uzs(1_000n).times(1.5)).toThrow(/rounding rule/);
  });
});

describe('Money.allocate', () => {
  it('splits evenly when it divides exactly', () => {
    const shares = uzs(900n).allocate([1n, 1n, 1n]);
    expect(shares.map((s) => s.minorUnits)).toEqual([300n, 300n, 300n]);
  });

  it('distributes the remainder instead of losing it', () => {
    const shares = uzs(100n).allocate([1n, 1n, 1n]);

    expect(shares.map((s) => s.minorUnits)).toEqual([34n, 33n, 33n]);
    expect(shares.reduce((sum, s) => sum + s.minorUnits, 0n)).toBe(100n);
  });

  it('respects weighted ratios', () => {
    const shares = uzs(10_000n).allocate([70n, 30n]);
    expect(shares.map((s) => s.minorUnits)).toEqual([7_000n, 3_000n]);
  });

  it('always sums back to the original, for any split', () => {
    const amounts = [1n, 7n, 99n, 100n, 1_000n, 999_999n, 1_000_000_007n];
    const ratioSets = [
      [1n, 1n],
      [1n, 1n, 1n],
      [1n, 2n, 3n],
      [97n, 2n, 1n],
      [1n, 1n, 1n, 1n, 1n, 1n, 1n],
    ];

    for (const amount of amounts) {
      for (const ratios of ratioSets) {
        const shares = uzs(amount).allocate(ratios);
        const total = shares.reduce((sum, share) => sum + share.minorUnits, 0n);

        expect(total, `${amount} split by [${ratios.join(',')}]`).toBe(amount);
        expect(shares).toHaveLength(ratios.length);
      }
    }
  });

  it('handles negative amounts without losing units', () => {
    const shares = uzs(-100n).allocate([1n, 1n, 1n]);

    expect(shares.reduce((sum, s) => sum + s.minorUnits, 0n)).toBe(-100n);
  });

  it('allows a zero ratio', () => {
    const shares = uzs(100n).allocate([1n, 0n, 1n]);

    expect(shares[1]!.minorUnits).toBe(0n);
    expect(shares.reduce((sum, s) => sum + s.minorUnits, 0n)).toBe(100n);
  });

  it('rejects degenerate inputs', () => {
    expect(() => uzs(100n).allocate([])).toThrow(/at least one ratio/);
    expect(() => uzs(100n).allocate([0n, 0n])).toThrow(/sum to zero/);
    expect(() => uzs(100n).allocate([1n, -1n])).toThrow(/must not be negative/);
  });
});

describe('Money comparison', () => {
  it('compares within a currency', () => {
    expect(uzs(1_000n).isGreaterThan(uzs(999n))).toBe(true);
    expect(uzs(1_000n).isGreaterThanOrEqual(uzs(1_000n))).toBe(true);
    expect(uzs(999n).isLessThan(uzs(1_000n))).toBe(true);
  });

  it('treats different currencies as unequal rather than throwing', () => {
    expect(uzs(1_000n).equals(krw(1_000n))).toBe(false);
  });

  it('exposes sign predicates', () => {
    expect(uzs(0n).isZero).toBe(true);
    expect(uzs(1n).isPositive).toBe(true);
    expect(uzs(-1n).isNegative).toBe(true);
  });
});

describe('Money serialisation', () => {
  it('formats decimals according to the currency exponent', () => {
    expect(Money.fromMinorUnits(1050n, 'USD').toDecimalString()).toBe('10.50');
    expect(Money.fromMinorUnits(5n, 'USD').toDecimalString()).toBe('0.05');
    expect(Money.fromMinorUnits(1000n, 'KRW').toDecimalString()).toBe('1000');
    expect(Money.fromMinorUnits(-1050n, 'USD').toDecimalString()).toBe('-10.50');
  });

  it('emits amounts as strings in JSON', () => {
    const json = JSON.parse(JSON.stringify(Money.fromMinorUnits('9007199254740993', 'UZS')));

    expect(json).toEqual({ amount: '9007199254740993', currency: 'UZS' });
    expect(typeof json.amount).toBe('string');
  });

  it('round-trips through the database representation', () => {
    const original = Money.fromDecimal('12345.67', 'USD');
    const restored = Money.fromMinorUnits(original.toDatabaseValue(), 'USD');

    expect(restored.equals(original)).toBe(true);
  });

  it('round-trips through decimal formatting', () => {
    for (const amount of [0n, 1n, 99n, 100n, 1050n, -1050n, 999_999_999n]) {
      const original = Money.fromMinorUnits(amount, 'USD');
      const restored = Money.fromDecimal(original.toDecimalString(), 'USD');

      expect(restored.equals(original)).toBe(true);
    }
  });
});
