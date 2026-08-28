import { Body, Controller, Param, Post, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { IdempotencyInterceptor } from '../../idempotency/api/idempotency.interceptor.js';
import { ReversalService } from '../application/reversal.service.js';

const transactionIdParam = z.object({ id: z.string().uuid() }).strict();

const reversalBodySchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class ReversalController {
  constructor(private readonly reversals: ReversalService) {}

  @Post('transactions/:id/reversal')
  async reverse(
    @Param(new ZodValidationPipe(transactionIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(reversalBodySchema))
    body: { reason?: string; metadata?: Record<string, unknown> },
  ): Promise<{
    id: string;
    reversesId: string | null;
    amount: string;
    currency: string;
    originalStatus: string;
    createdAt: string;
  }> {
    const { reversal, original } = await this.reversals.reverse(params.id, {
      ...(body.metadata ?? {}),
      ...(body.reason ? { reason: body.reason } : {}),
    });

    return {
      id: reversal.id,
      reversesId: reversal.reversesId,
      amount: reversal.amount,
      currency: reversal.currency,
      originalStatus: original.status,
      createdAt: reversal.createdAt,
    };
  }
}
