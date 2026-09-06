import { Money } from '../../../shared/money/index';
import { InsufficientFundsError } from '../../../shared/errors/ledger.errors';

export class Balance {
  constructor(
    readonly accountId: string,
    readonly amount: Money,
    readonly asOfEntryId: string | null,
    readonly entryCount: number,
  ) {}

  static empty(accountId: string, currency: string): Balance {
    return new Balance(accountId, Money.zero(currency), null, 0);
  }

  get currency(): string {
    return this.amount.currency.code;
  }

  covers(amount: Money): boolean {
    return this.amount.isGreaterThanOrEqual(amount);
  }

  assertCovers(amount: Money): void {
    if (!this.covers(amount)) {
      throw new InsufficientFundsError(
        this.accountId,
        this.amount.minorUnits,
        amount.minorUnits,
        this.currency,
      );
    }
  }

  toJSON(): {
    accountId: string;
    amount: string;
    currency: string;
    asOfEntryId: string | null;
    entryCount: number;
  } {
    return {
      accountId: this.accountId,
      amount: this.amount.minorUnits.toString(),
      currency: this.currency,
      asOfEntryId: this.asOfEntryId,
      entryCount: this.entryCount,
    };
  }
}
