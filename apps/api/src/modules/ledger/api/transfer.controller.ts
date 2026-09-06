import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { Money, currencyCodes } from '../../../shared/money/index';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../idempotency/api/idempotency.interceptor';
import { TransferService } from '../application/transfer.service';
import { TransactionRepository } from '../infrastructure/transaction.repository';

const minorUnits = z
  .string()
  .regex(/^\d+$/, 'must be a positive integer in minor units, as a string')
  .refine((value) => BigInt(value) > 0n, 'must be greater than zero');

const transferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: minorUnits,
    currency: z.enum(currencyCodes() as [string, ...string[]]),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const historyQuerySchema = z
  .object({
    accountId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(20),

    beforeEntryId: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

const transactionIdParam = z.object({ id: z.string().uuid() }).strict();

@Controller()
export class TransferController {
  constructor(
    private readonly transfers: TransferService,
    private readonly repository: TransactionRepository,
  ) {}

  @Post('transfers')
  @UseInterceptors(IdempotencyInterceptor)
  async transfer(
    @Body(new ZodValidationPipe(transferSchema))
    body: {
      fromAccountId: string;
      toAccountId: string;
      amount: string;
      currency: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{
    id: string;
    status: string;
    amount: string;
    currency: string;
    createdAt: string;
    balances: { from: string; to: string };
  }> {
    const result = await this.transfers.transfer({
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amount: Money.fromMinorUnits(body.amount, body.currency),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });

    return {
      id: result.transaction.id,
      status: result.transaction.status,
      amount: result.transaction.amount,
      currency: result.transaction.currency,
      createdAt: result.transaction.createdAt,
      balances: {
        from: result.fromBalance.amount.minorUnits.toString(),
        to: result.toBalance.amount.minorUnits.toString(),
      },
    };
  }

  @Get('transactions/:id')
  async get(
    @Param(new ZodValidationPipe(transactionIdParam)) params: { id: string },
  ): Promise<unknown> {
    const transaction = await this.repository.findById(params.id);

    if (!transaction) {
      return { error: 'not found' };
    }

    const entries = await this.repository.findEntries(params.id);

    return {
      ...transaction,
      entries: entries.map((entry) => ({
        id: entry.id,
        accountId: entry.account_id,
        direction: entry.direction,
        amount: entry.amount,
      })),
    };
  }

  @Get('transactions')
  @HttpCode(200)
  async history(
    @Query(new ZodValidationPipe(historyQuerySchema))
    query: {
      accountId: string;
      limit: number;
      beforeEntryId?: string;
    },
  ): Promise<{ transactions: unknown[]; nextCursor: string | null }> {
    const rows = await this.repository.findByAccount(query.accountId, {
      limit: query.limit,
      ...(query.beforeEntryId ? { beforeEntryId: query.beforeEntryId } : {}),
    });

    return {
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        direction: row.direction,
        createdAt: row.createdAt,
        metadata: row.metadata,
      })),

      nextCursor: rows.length === query.limit ? (rows.at(-1)?.entryId ?? null) : null,
    };
  }
}
