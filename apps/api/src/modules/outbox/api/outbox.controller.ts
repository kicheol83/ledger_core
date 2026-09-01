import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe.js';
import { OutboxRepository, type OutboxEvent } from '../infrastructure/outbox.repository.js';

const listQuery = z
  .object({
    status: z.enum(['PENDING', 'PUBLISHED', 'FAILED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    beforeId: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

interface EventResponse {
  id: string;
  aggregateId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  publishedAt: string | null;
}

function toResponse(event: OutboxEvent): EventResponse {
  return {
    id: event.id,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    status: event.status,
    attempts: event.attempts,
    lastError: event.lastError,
    createdAt: event.createdAt,
    publishedAt: event.publishedAt,
  };
}

@Controller('outbox')
export class OutboxController {
  constructor(
    private readonly events: OutboxRepository,
    private readonly transactions: TransactionManager,
  ) {}

  @Get('stats')
  async stats(): Promise<{
    pending: number;
    published: number;
    failed: number;
    oldestPendingAgeSeconds: number | null;
  }> {
    return this.transactions.run(async () => this.events.stats(), { readOnly: true });
  }

  @Get('events')
  async list(
    @Query(new ZodValidationPipe(listQuery))
    query: {
      status?: 'PENDING' | 'PUBLISHED' | 'FAILED';
      limit: number;
      beforeId?: string;
    },
  ): Promise<{ events: EventResponse[]; nextCursor: string | null }> {
    const events = await this.transactions.run(
      async () =>
        this.events.list({
          limit: query.limit,
          ...(query.status ? { status: query.status } : {}),
          ...(query.beforeId ? { beforeId: query.beforeId } : {}),
        }),
      { readOnly: true },
    );

    return {
      events: events.map(toResponse),
      nextCursor: events.length === query.limit ? (events.at(-1)?.id ?? null) : null,
    };
  }
}
