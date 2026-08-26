import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import { AccountNotFoundError } from '../../../shared/errors/ledger.errors.js';
import { getCurrency } from '../../../shared/money/index.js';
import type { Account, AccountStatus } from '../domain/account.js';
import { AccountRepository } from '../infrastructure/account.repository.js';

@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async createUser(email: string): Promise<{ id: string; email: string; createdAt: string }> {
    const existing = await this.accounts.findUserByEmail(email);

    if (existing) {
      throw new ConflictException(`a user with email ${email} already exists`);
    }

    const user = await this.accounts.createUser(email);
    return { id: user.id, email: user.email, createdAt: user.created_at };
  }

  async createAccount(userId: string, currency: string): Promise<Account> {
    getCurrency(currency);

    return this.transactions.run(async () => {
      const user = await this.accounts.findUserById(userId);

      if (!user) {
        throw new NotFoundException(`user ${userId} does not exist`);
      }

      if (user.status !== 'ACTIVE') {
        throw new ConflictException(`user ${userId} is ${user.status.toLowerCase()}`);
      }

      return this.accounts.create(userId, currency);
    });
  }

  async getAccount(id: string): Promise<Account> {
    const account = await this.accounts.findById(id);

    if (!account) {
      throw new AccountNotFoundError(id);
    }

    return account;
  }

  async listAccounts(userId: string): Promise<Account[]> {
    return this.accounts.findByUser(userId);
  }

  async getSystemAccount(currency: string): Promise<Account> {
    const account = await this.accounts.findSystemAccount(currency);

    if (!account) {
      throw new NotFoundException(
        `no system account exists for ${currency}; run db/seeds/01-system-accounts.sql`,
      );
    }

    return account;
  }

  async setStatus(id: string, status: AccountStatus): Promise<Account> {
    const account = await this.accounts.updateStatus(id, status);

    if (!account) {
      throw new AccountNotFoundError(id);
    }

    return account;
  }
}
