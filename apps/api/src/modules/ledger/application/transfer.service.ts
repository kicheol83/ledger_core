import { Injectable, Logger } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager';
import {
  AccountNotActiveError,
  AccountNotFoundError,
  CurrencyMismatchError,
  SameAccountTransferError,
} from '../../../shared/errors/ledger.errors';
import { Money } from '../../../shared/money/index';
import { Balance } from '../domain/balance';
import { simpleTransfer, type BalancedEntries } from '../domain/ledger-entry';
import { OutboxService } from '../../outbox/application/outbox.service';
import { BalanceRepository } from '../infrastructure/balance.repository';
import {
  TransactionRepository,
  type LockedAccount,
  type PersistedTransaction,
} from '../infrastructure/transaction.repository';

export interface TransferCommand {
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly balances: BalanceRepository,
    private readonly outbox: OutboxService,
    private readonly transactions: TransactionManager,
  ) {}

  async transfer(command: TransferCommand): Promise<{
    transaction: PersistedTransaction;
    fromBalance: Balance;
    toBalance: Balance;
  }> {
    if (command.fromAccountId === command.toAccountId) {
      throw new SameAccountTransferError(command.fromAccountId);
    }

    return this.transactions.run(async () => {
      const entries = simpleTransfer(command.fromAccountId, command.toAccountId, command.amount);

      const accounts = await this.transactionRepository.lockAccounts(entries.accountIds);

      const source = this.requireAccount(accounts, command.fromAccountId);
      const destination = this.requireAccount(accounts, command.toAccountId);

      this.assertUsable(source, command.amount);
      this.assertUsable(destination, command.amount);

      const balancesBefore = await this.balances.balancesOf([
        { id: source.id, currency: source.currency },
        { id: destination.id, currency: destination.currency },
      ]);

      if (!source.type.includes('SYSTEM')) {
        balancesBefore.get(source.id)!.assertCovers(command.amount);
      }

      const transaction = await this.transactionRepository.insertTransaction({
        type: 'TRANSFER',
        status: 'COMPLETED',
        amount: command.amount,
        metadata: command.metadata ?? {},
      });

      await this.transactionRepository.insertEntries(transaction.id, entries);

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
        ...(command.metadata ? { metadata: command.metadata } : {}),
      });

      const balancesAfter = await this.balances.balancesOf([
        { id: source.id, currency: source.currency },
        { id: destination.id, currency: destination.currency },
      ]);

      this.logger.debug(
        `transfer ${transaction.id}: ${command.amount.toString()} ` +
          `${source.id} -> ${destination.id}`,
      );

      return {
        transaction,
        fromBalance: balancesAfter.get(source.id)!,
        toBalance: balancesAfter.get(destination.id)!,
      };
    });
  }

  async postEntries(params: {
    type: PersistedTransaction['type'];
    amount: Money;
    entries: BalancedEntries;
    reversesId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<PersistedTransaction> {
    const transaction = await this.transactionRepository.insertTransaction({
      type: params.type,
      status: 'COMPLETED',
      amount: params.amount,
      reversesId: params.reversesId ?? null,
      metadata: params.metadata ?? {},
    });

    await this.transactionRepository.insertEntries(transaction.id, params.entries);

    await this.outbox.emitTransactionEvent({
      transactionId: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      occurredAt: transaction.createdAt,
      entries: params.entries.entries.map((entry) => ({
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount.toDatabaseValue(),
      })),
      reversesId: params.reversesId ?? null,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    });

    return transaction;
  }

  private requireAccount(accounts: LockedAccount[], id: string): LockedAccount {
    const account = accounts.find((candidate) => candidate.id === id);

    if (!account) {
      throw new AccountNotFoundError(id);
    }

    return account;
  }

  private assertUsable(account: LockedAccount, amount: Money): void {
    if (account.status !== 'ACTIVE') {
      throw new AccountNotActiveError(account.id, account.status);
    }

    if (account.currency !== amount.currency.code) {
      throw new CurrencyMismatchError(amount.currency.code, account.currency);
    }
  }
}
