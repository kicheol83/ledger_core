export interface CurrencyDefinition {
  readonly code: string;
  readonly exponent: number;
  readonly name: string;
}

const CURRENCIES = {
  UZS: { code: 'UZS', exponent: 2, name: 'Uzbekistani soʻm' },
  KRW: { code: 'KRW', exponent: 0, name: 'South Korean won' },
  USD: { code: 'USD', exponent: 2, name: 'United States dollar' },
  EUR: { code: 'EUR', exponent: 2, name: 'Euro' },
  JPY: { code: 'JPY', exponent: 0, name: 'Japanese yen' },
} as const satisfies Record<string, CurrencyDefinition>;

export type CurrencyCode = keyof typeof CURRENCIES;

export class UnknownCurrencyError extends Error {
  constructor(code: string) {
    super(`unknown currency: ${code}`);
    this.name = 'UnknownCurrencyError';
  }
}

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function getCurrency(code: string): CurrencyDefinition {
  if (!isCurrencyCode(code)) {
    throw new UnknownCurrencyError(code);
  }
  return CURRENCIES[code];
}

export function currencyCodes(): CurrencyCode[] {
  return Object.keys(CURRENCIES) as CurrencyCode[];
}
