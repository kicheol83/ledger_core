import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager';
import { AccountNotFoundError } from '../../../shared/errors/ledger.errors';
import type { Money } from '../../../shared/money/index';
import { AccountService } from '../../accounts/application/account.service';
import type { Balance } from '../domain/balance';
import { BalanceRepository } from '../infrastructure/balance.repository';

@Injectable()
export class BalanceService {
  constructor(
    private readonly balances: BalanceRepository,

    private readonly accounts: AccountService,
    private readonly transactions: TransactionManager,
  ) {}

  async getBalance(accountId: string): Promise<Balance> {
    const balance = await this.balances.currentBalance(accountId);

    if (!balance) {
      throw new AccountNotFoundError(accountId);
    }

    return balance;
  }

  async getBalanceAsOf(accountId: string, entryId: string): Promise<Balance> {
    return this.transactions.run(
      async () => {
        const account = await this.accounts.getAccount(accountId);
        return this.balances.balanceAsOf(account.id, account.currency, entryId);
      },
      { readOnly: true },
    );
  }

  async getBalancesForUser(userId: string): Promise<Balance[]> {
    return this.transactions.run(
      async () => {
        const accounts = await this.accounts.listAccounts(userId);

        const balances = await this.balances.balancesOf(
          accounts.map((account) => ({ id: account.id, currency: account.currency })),
        );

        return accounts.map((account) => balances.get(account.id)!);
      },
      { readOnly: true },
    );
  }

  async systemImbalance(currency: string): Promise<Money> {
    return this.balances.systemImbalance(currency);
  }
}
