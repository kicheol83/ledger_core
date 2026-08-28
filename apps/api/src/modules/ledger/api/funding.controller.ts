import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { Money, currencyCodes } from '../../../shared/money/index.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { IdempotencyInterceptor } from '../../idempotency/api/idempotency.interceptor.js';
import { FundingService } from '../application/funding.service.js';

const fundingSchema = z
  .object({
    accountId: z.string().uuid(),
    amount: z
      .string()
      .regex(/^\d+$/, 'must be a positive integer in minor units, as a string')
      .refine((value) => BigInt(value) > 0n, 'must be greater than zero'),
    currency: z.enum(currencyCodes() as [string, ...string[]]),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

type FundingBody = z.infer<typeof fundingSchema>;

interface FundingResponse {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  balance: string;
  createdAt: string;
}

@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @Post('deposits')
  async deposit(
    @Body(new ZodValidationPipe(fundingSchema)) body: FundingBody,
  ): Promise<FundingResponse> {
    const result = await this.funding.deposit({
      accountId: body.accountId,
      amount: Money.fromMinorUnits(body.amount, body.currency),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });

    return toResponse(result.transaction, result.balance.amount.minorUnits.toString());
  }

  @Post('withdrawals')
  async withdraw(
    @Body(new ZodValidationPipe(fundingSchema)) body: FundingBody,
  ): Promise<FundingResponse> {
    const result = await this.funding.withdraw({
      accountId: body.accountId,
      amount: Money.fromMinorUnits(body.amount, body.currency),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });

    return toResponse(result.transaction, result.balance.amount.minorUnits.toString());
  }
}

function toResponse(
  transaction: {
    id: string;
    type: string;
    status: string;
    amount: string;
    currency: string;
    createdAt: string;
  },
  balance: string,
): FundingResponse {
  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    amount: transaction.amount,
    currency: transaction.currency,
    balance,
    createdAt: transaction.createdAt,
  };
}
