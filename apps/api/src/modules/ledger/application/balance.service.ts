import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import type { Money } from '../../../shared/money/index.js';
import { AccountService } from '../../accounts/application/account.service.js';
import type { Balance } from '../domain/balance.js';
import { BalanceRepository } from '../infrastructure/balance.repository.js';

@Injectable()
export class BalanceService {
  constructor(
    private readonly balances: BalanceRepository,

    private readonly accounts: AccountService,
    private readonly transactions: TransactionManager,
  ) {}

  async getBalance(accountId: string): Promise<Balance> {
    return this.transactions.run(
      async () => {
        const account = await this.accounts.getAccount(accountId);
        return this.balances.balanceOf(account.id, account.currency);
      },
      { readOnly: true },
    );
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
