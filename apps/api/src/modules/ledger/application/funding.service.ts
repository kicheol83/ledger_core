import { Injectable, Logger } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import {
  AccountNotActiveError,
  AccountNotFoundError,
  CurrencyMismatchError,
} from '../../../shared/errors/ledger.errors.js';
import { Money } from '../../../shared/money/index.js';
import { AccountService } from '../../accounts/application/account.service.js';
import type { Balance } from '../domain/balance.js';
import { simpleTransfer } from '../domain/ledger-entry.js';
import { OutboxService } from '../../outbox/application/outbox.service.js';
import { BalanceRepository } from '../infrastructure/balance.repository.js';
import {
  TransactionRepository,
  type LockedAccount,
  type PersistedTransaction,
} from '../infrastructure/transaction.repository.js';

export interface FundingCommand {
  accountId: string;
  amount: Money;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly balances: BalanceRepository,
    private readonly accounts: AccountService,
    private readonly outbox: OutboxService,
    private readonly transactions: TransactionManager,
  ) {}

  async deposit(command: FundingCommand): Promise<{
    transaction: PersistedTransaction;
    balance: Balance;
  }> {
    return this.transactions.run(async () => {
      const { target, system } = await this.lockPair(command.accountId, command.amount);

      const entries = simpleTransfer(system.id, target.id, command.amount);

      const transaction = await this.transactionRepository.insertTransaction({
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: command.amount,
        metadata: command.metadata ?? {},
      });

      await this.transactionRepository.insertEntries(transaction.id, entries);

      await this.emitEvent(transaction, entries, command.metadata);

      const balance = await this.balances.balanceOf(target.id, target.currency);

      this.logger.debug(`deposit ${transaction.id}: ${command.amount.toString()} -> ${target.id}`);

      return { transaction, balance };
    });
  }

  async withdraw(command: FundingCommand): Promise<{
    transaction: PersistedTransaction;
    balance: Balance;
  }> {
    return this.transactions.run(async () => {
      const { target, system } = await this.lockPair(command.accountId, command.amount);

      const balanceBefore = await this.balances.balanceOf(target.id, target.currency);
      balanceBefore.assertCovers(command.amount);

      const entries = simpleTransfer(target.id, system.id, command.amount);

      const transaction = await this.transactionRepository.insertTransaction({
        type: 'WITHDRAWAL',
        status: 'COMPLETED',
        amount: command.amount,
        metadata: command.metadata ?? {},
      });

      await this.transactionRepository.insertEntries(transaction.id, entries);

      await this.emitEvent(transaction, entries, command.metadata);

      const balance = await this.balances.balanceOf(target.id, target.currency);

      this.logger.debug(
        `withdrawal ${transaction.id}: ${command.amount.toString()} <- ${target.id}`,
      );

      return { transaction, balance };
    });
  }

  private async emitEvent(
    transaction: PersistedTransaction,
    entries: { entries: readonly { accountId: string; direction: string; amount: Money }[] },
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.outbox.emitTransactionEvent({
      transactionId: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      occurredAt: transaction.createdAt,
      entries: entries.entries.map((entry) => ({
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount.toDatabaseValue(),
      })),
      ...(metadata ? { metadata } : {}),
    });
  }

  private async lockPair(
    accountId: string,
    amount: Money,
  ): Promise<{ target: LockedAccount; system: LockedAccount }> {
    const systemAccount = await this.accounts.getSystemAccount(amount.currency.code);

    const locked = await this.transactionRepository.lockAccounts([accountId, systemAccount.id]);

    const target = locked.find((account) => account.id === accountId);
    const system = locked.find((account) => account.id === systemAccount.id);

    if (!target) {
      throw new AccountNotFoundError(accountId);
    }

    if (!system) {
      throw new AccountNotFoundError(systemAccount.id);
    }

    if (target.type === 'SYSTEM') {
      throw new AccountNotActiveError(target.id, 'SYSTEM');
    }

    if (target.status !== 'ACTIVE') {
      throw new AccountNotActiveError(target.id, target.status);
    }

    if (target.currency !== amount.currency.code) {
      throw new CurrencyMismatchError(amount.currency.code, target.currency);
    }

    return { target, system };
  }
}
