import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe';
import { BalanceService } from '../application/balance.service';

const accountIdParam = z.object({ id: z.string().uuid() }).strict();

const asOfQuery = z
  .object({
    asOfEntryId: z.string().regex(/^\d+$/, 'must be a positive integer').optional(),
  })
  .strict();

const userIdQuery = z.object({ userId: z.string().uuid() }).strict();

const currencyQuery = z.object({ currency: z.string().regex(/^[A-Z]{3}$/) }).strict();

interface BalanceResponse {
  accountId: string;
  amount: string;
  currency: string;
  asOfEntryId: string | null;
  entryCount: number;
}

@Controller()
export class BalanceController {
  constructor(private readonly balances: BalanceService) {}

  @Get('accounts/:id/balance')
  async getBalance(
    @Param(new ZodValidationPipe(accountIdParam)) params: { id: string },
    @Query(new ZodValidationPipe(asOfQuery)) query: { asOfEntryId?: string },
  ): Promise<BalanceResponse> {
    const balance = query.asOfEntryId
      ? await this.balances.getBalanceAsOf(params.id, query.asOfEntryId)
      : await this.balances.getBalance(params.id);

    return balance.toJSON();
  }

  @Get('balances')
  async listBalances(
    @Query(new ZodValidationPipe(userIdQuery)) query: { userId: string },
  ): Promise<{ balances: BalanceResponse[] }> {
    const balances = await this.balances.getBalancesForUser(query.userId);
    return { balances: balances.map((balance) => balance.toJSON()) };
  }

  @Get('ledger/reconciliation')
  async reconciliation(
    @Query(new ZodValidationPipe(currencyQuery)) query: { currency: string },
  ): Promise<{ currency: string; imbalance: string; balanced: boolean }> {
    const imbalance = await this.balances.systemImbalance(query.currency);

    return {
      currency: query.currency,
      imbalance: imbalance.minorUnits.toString(),
      balanced: imbalance.isZero,
    };
  }
}
