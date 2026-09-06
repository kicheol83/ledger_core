import { describe, expect, it } from 'vitest';
import {
  AmountError,
  formatAmount,
  formatMoney,
  formatTimestamp,
  isNegative,
  isZero,
  shortId,
  sumMinorUnits,
  toDecimal,
  toMinorUnits,
} from './money';

describe('toDecimal', () => {
  it('scales by the currency exponent', () => {
    expect(toDecimal('1050', 'USD')).toBe('10.50');
    expect(toDecimal('5', 'USD')).toBe('0.05');
    expect(toDecimal('0', 'USD')).toBe('0.00');
  });

  it('leaves zero-exponent currencies unscaled', () => {
    expect(toDecimal('1000', 'KRW')).toBe('1000');
  });

  it('handles negatives', () => {
    expect(toDecimal('-1050', 'USD')).toBe('-10.50');
  });
});

describe('formatAmount', () => {
  it('groups thousands', () => {
    expect(formatAmount('123456789', 'UZS')).toBe('1\u2009234\u2009567.89');
  });

  it('uses a minus sign rather than a hyphen', () => {
    expect(formatAmount('-500', 'USD')).toContain('\u2212');
    expect(formatAmount('-500', 'USD')).not.toContain('-');
  });

  it('survives amounts past Number.MAX_SAFE_INTEGER', () => {
    expect(formatAmount('9007199254740993', 'KRW')).toBe(
      '9\u2009007\u2009199\u2009254\u2009740\u2009993',
    );
  });

  it('formats zero', () => {
    expect(formatAmount('0', 'UZS')).toBe('0.00');
    expect(formatAmount('0', 'KRW')).toBe('0');
  });
});

describe('formatMoney', () => {
  it('appends the currency code', () => {
    expect(formatMoney('1050', 'USD')).toBe('10.50 USD');
  });
});

describe('sumMinorUnits', () => {
  it('sums without going through number', () => {
    expect(sumMinorUnits(['9007199254740993', '1'])).toBe('9007199254740994');
  });

  it('handles an empty list', () => {
    expect(sumMinorUnits([])).toBe('0');
  });

  it('sums a balanced pair to zero', () => {
    expect(sumMinorUnits(['5000', '-5000'])).toBe('0');
  });
});

describe('predicates', () => {
  it('detects negatives without parsing', () => {
    expect(isNegative('-1')).toBe(true);
    expect(isNegative('0')).toBe(false);
  });

  it('detects zero', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('-0')).toBe(true);
    expect(isZero('1')).toBe(false);
  });
});

describe('shortId', () => {
  it('truncates a uuid', () => {
    expect(shortId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400…');
  });

  it('leaves a short id alone', () => {
    expect(shortId('abc')).toBe('abc');
  });
});

describe('formatTimestamp', () => {
  it('uses a fixed, sortable format', () => {
    expect(formatTimestamp('2026-03-09T14:05:09.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatTimestamp('not a date')).toBe('not a date');
  });
});

describe('toMinorUnits', () => {
  it('scales a decimal to minor units', () => {
    expect(toMinorUnits('10.50', 'USD')).toBe('1050');
    expect(toMinorUnits('10.5', 'USD')).toBe('1050');
    expect(toMinorUnits('10', 'USD')).toBe('1000');
  });

  it('does not scale a zero-exponent currency', () => {
    expect(toMinorUnits('1000', 'KRW')).toBe('1000');
  });

  it('avoids the float rounding bug', () => {
    expect(toMinorUnits('4.35', 'USD')).toBe('435');
    expect(toMinorUnits('8.20', 'USD')).toBe('820');
    expect(toMinorUnits('0.07', 'USD')).toBe('7');
    expect(toMinorUnits('1.10', 'USD')).toBe('110');
    expect(toMinorUnits('1.15', 'USD')).toBe('115');
  });

  it('handles amounts past Number.MAX_SAFE_INTEGER', () => {
    expect(toMinorUnits('90071992547409.93', 'USD')).toBe('9007199254740993');
  });

  it('rejects more precision than the currency has', () => {
    expect(() => toMinorUnits('10.505', 'USD')).toThrow(AmountError);
    expect(() => toMinorUnits('10.5', 'KRW')).toThrow(/no smaller unit/);
  });

  it('rejects zero and non-numeric input', () => {
    expect(() => toMinorUnits('0', 'USD')).toThrow(/above zero/);
    expect(() => toMinorUnits('', 'USD')).toThrow(/Enter an amount/);
    expect(() => toMinorUnits('ten', 'USD')).toThrow(AmountError);
    expect(() => toMinorUnits('1.2.3', 'USD')).toThrow(AmountError);
  });

  it('tolerates grouping characters a person may paste in', () => {
    expect(toMinorUnits('1 234.50', 'USD')).toBe('123450');
    expect(toMinorUnits('1,234.50', 'USD')).toBe('123450');
  });

  it('round-trips with formatting', () => {
    for (const value of ['0.01', '10.50', '999999.99']) {
      expect(toDecimal(toMinorUnits(value, 'USD'), 'USD')).toBe(
        value.includes('.') ? value : `${value}.00`,
      );
    }
  });
});
