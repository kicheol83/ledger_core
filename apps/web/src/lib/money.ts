const EXPONENTS: Record<string, number> = {
  UZS: 2,
  KRW: 0,
  USD: 2,
  EUR: 2,
  JPY: 0,
};

export function exponentFor(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

export function toDecimal(minorUnits: string, currency: string): string {
  const exponent = exponentFor(currency);
  const negative = minorUnits.startsWith('-');
  const digits = negative ? minorUnits.slice(1) : minorUnits;

  if (exponent === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

export function formatAmount(minorUnits: string, currency: string): string {
  const decimal = toDecimal(minorUnits, currency);
  const negative = decimal.startsWith('-');
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole = '0', fraction] = unsigned.split('.');

  const formatted = fraction ? `${group(whole)}.${fraction}` : group(whole);

  return `${negative ? '\u2212' : ''}${formatted}`;
}

export function formatMoney(minorUnits: string, currency: string): string {
  return `${formatAmount(minorUnits, currency)} ${currency}`;
}

export function isNegative(minorUnits: string): boolean {
  return minorUnits.startsWith('-');
}

export function isZero(minorUnits: string): boolean {
  return BigInt(minorUnits) === 0n;
}

export function sumMinorUnits(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export class AmountError extends Error {}

export function toMinorUnits(input: string, currency: string): string {
  const trimmed = input.trim().replace(/[\s\u2009,]/g, '');

  if (trimmed.length === 0) {
    throw new AmountError('Enter an amount.');
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AmountError('Use digits and at most one decimal point.');
  }

  const exponent = exponentFor(currency);
  const [whole = '0', fraction = ''] = trimmed.split('.');

  if (fraction.length > exponent) {
    throw new AmountError(
      exponent === 0
        ? `${currency} has no smaller unit, so no decimals.`
        : `${currency} goes to ${exponent} decimal places.`,
    );
  }

  const minorUnits = BigInt(whole + fraction.padEnd(exponent, '0'));

  if (minorUnits <= 0n) {
    throw new AmountError('Enter an amount above zero.');
  }

  return minorUnits.toString();
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) {
    return iso;
  }

  const seconds = Math.floor((Date.now() - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
