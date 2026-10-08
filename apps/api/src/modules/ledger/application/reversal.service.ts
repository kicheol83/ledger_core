import { Injectable, Logger } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager';
import {
  AlreadyReversedError,
  InsufficientFundsError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
} from '../../../shared/errors/ledger.errors';
import { Money } from '../../../shared/money/index';
import { BalancedEntries, type LedgerEntry } from '../domain/ledger-entry';
import { OutboxService } from '../../outbox/application/outbox.service';
import { BalanceRepository } from '../infrastructure/balance.repository';
import {
  TransactionRepository,
  type PersistedTransaction,
} from '../infrastructure/transaction.repository';

@Injectable()
export class ReversalService {
  private readonly logger = new Logger(ReversalService.name);

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly balances: BalanceRepository,
    private readonly outbox: OutboxService,
    private readonly transactions: TransactionManager,
  ) {}

  async reverse(
    transactionId: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ reversal: PersistedTransaction; original: PersistedTransaction }> {
    return this.transactions.run(async () => {
      const original = await this.transactionRepository.findById(transactionId);

      if (!original) {
        throw new TransactionNotFoundError(transactionId);
      }

      if (original.type === 'REVERSAL') {
        throw new TransactionNotReversibleError(
          transactionId,
          'it is itself a reversal; issue a new transaction in the original direction instead',
        );
      }

      if (original.status === 'REVERSED') {
        throw new AlreadyReversedError(transactionId);
      }

      if (original.status !== 'COMPLETED') {
        throw new TransactionNotReversibleError(transactionId, `its status is ${original.status}`);
      }

      const originalEntries = await this.transactionRepository.findEntries(transactionId);

      const mirrored = BalancedEntries.of(
        originalEntries.map<LedgerEntry>((entry) => ({
          accountId: entry.account_id,

          direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
          amount: Money.fromMinorUnits(entry.amount, original.currency),
        })),
      );

      const locked = await this.transactionRepository.lockAccounts(mirrored.accountIds);

      const current = await this.transactionRepository.findById(transactionId);

      if (current?.status === 'REVERSED') {
        throw new AlreadyReversedError(transactionId);
      }

      await this.assertRecipientsCanRepay(mirrored, locked, original.currency);

      const reversal = await this.transactionRepository.insertTransaction({
        type: 'REVERSAL',
        status: 'COMPLETED',
        amount: Money.fromMinorUnits(original.amount, original.currency),
        reversesId: original.id,
        metadata: metadata ?? {},
      });

      await this.transactionRepository.insertEntries(reversal.id, mirrored);

      await this.transactionRepository.markReversed(original.id);

      await this.outbox.emitTransactionEvent({
        transactionId: reversal.id,
        type: reversal.type,
        amount: reversal.amount,
        currency: reversal.currency,
        occurredAt: reversal.createdAt,
        entries: mirrored.entries.map((entry) => ({
          accountId: entry.accountId,
          direction: entry.direction,
          amount: entry.amount.toDatabaseValue(),
        })),
        reversesId: original.id,
        ...(metadata ? { metadata } : {}),
      });

      const updated = await this.transactionRepository.findById(original.id);

      this.logger.debug(`reversal ${reversal.id} undoes ${original.id}`);

      return { reversal, original: updated! };
    });
  }

  private async assertRecipientsCanRepay(
    mirrored: BalancedEntries,
    locked: Array<{ id: string; currency: string; type: string }>,
    currency: string,
  ): Promise<void> {
    const debited = mirrored.entries.filter((entry) => entry.direction === 'DEBIT');

    if (debited.length === 0) {
      return;
    }

    const balances = await this.balances.balancesOf(
      locked.map((account) => ({ id: account.id, currency: account.currency })),
    );

    for (const entry of debited) {
      const account = locked.find((candidate) => candidate.id === entry.accountId);

      if (account?.type === 'SYSTEM') {
        continue;
      }

      const balance = balances.get(entry.accountId);

      if (balance && !balance.covers(entry.amount)) {
        throw new InsufficientFundsError(
          entry.accountId,
          balance.amount.minorUnits,
          entry.amount.minorUnits,
          currency,
        );
      }
    }
  }
}
