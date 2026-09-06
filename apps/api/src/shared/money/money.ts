import { CurrencyMismatchError } from '../errors/ledger.errors';
import { getCurrency, type CurrencyDefinition } from './currency';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: CurrencyDefinition,
  ) {}

  static fromMinorUnits(minorUnits: bigint | string, currencyCode: string): Money {
    const currency = getCurrency(currencyCode);

    const value = typeof minorUnits === 'string' ? parseMinorUnits(minorUnits) : minorUnits;

    return new Money(value, currency);
  }

  static fromDecimal(decimal: string, currencyCode: string): Money {
    const currency = getCurrency(currencyCode);
    const trimmed = decimal.trim();

    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new InvalidMoneyError(`not a valid decimal amount: "${decimal}"`);
    }

    const negative = trimmed.startsWith('-');
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const [whole = '0', fraction = ''] = unsigned.split('.');

    if (fraction.length > currency.exponent) {
      throw new InvalidMoneyError(
        `${currency.code} has ${currency.exponent} decimal places, ` +
          `but "${decimal}" has ${fraction.length}`,
      );
    }

    const padded = fraction.padEnd(currency.exponent, '0');
    const combined = BigInt(whole + padded);

    return new Money(negative ? -combined : combined, currency);
  }

  static zero(currencyCode: string): Money {
    return new Money(0n, getCurrency(currencyCode));
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negated(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  absolute(): Money {
    return this.minorUnits < 0n ? this.negated() : this;
  }

  times(factor: bigint | number): Money {
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new InvalidMoneyError(
        `times() requires a whole number; ${factor} would need a rounding rule`,
      );
    }
    return new Money(this.minorUnits * BigInt(factor), this.currency);
  }

  allocate(ratios: bigint[]): Money[] {
    if (ratios.length === 0) {
      throw new InvalidMoneyError('allocate() needs at least one ratio');
    }

    if (ratios.some((ratio) => ratio < 0n)) {
      throw new InvalidMoneyError('allocate() ratios must not be negative');
    }

    const total = ratios.reduce((sum, ratio) => sum + ratio, 0n);

    if (total === 0n) {
      throw new InvalidMoneyError('allocate() ratios must not sum to zero');
    }

    const shares = ratios.map((ratio) => (this.minorUnits * ratio) / total);
    let remainder = this.minorUnits - shares.reduce((sum, share) => sum + share, 0n);

    const order = ratios
      .map((ratio, index) => ({
        index,
        remainder: (this.minorUnits * ratio) % total,
      }))
      .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0));

    const step = remainder < 0n ? -1n : 1n;
    let cursor = 0;

    while (remainder !== 0n) {
      const target = order[cursor % order.length]!.index;
      shares[target] = shares[target]! + step;
      remainder -= step;
      cursor += 1;
    }

    return shares.map((share) => new Money(share, this.currency));
  }

  equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.minorUnits === other.minorUnits;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits > other.minorUnits;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits >= other.minorUnits;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  get isZero(): boolean {
    return this.minorUnits === 0n;
  }

  get isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  get isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  toDatabaseValue(): string {
    return this.minorUnits.toString();
  }

  toDecimalString(): string {
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits).toString();

    if (this.currency.exponent === 0) {
      return negative ? `-${digits}` : digits;
    }

    const padded = digits.padStart(this.currency.exponent + 1, '0');
    const whole = padded.slice(0, -this.currency.exponent);
    const fraction = padded.slice(-this.currency.exponent);

    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.minorUnits.toString(), currency: this.currency.code };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency.code}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency.code !== other.currency.code) {
      throw new CurrencyMismatchError(this.currency.code, other.currency.code);
    }
  }
}

function parseMinorUnits(value: string): bigint {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new InvalidMoneyError(`not a valid minor-unit amount: "${value}"`);
  }
  return BigInt(value.trim());
}
