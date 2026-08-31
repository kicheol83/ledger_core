import { Injectable } from '@nestjs/common';
import {
  eventTypeForTransaction,
  transactionEventPayload,
  type OutboxEventInput,
} from '../domain/event.js';
import { OutboxRepository, type OutboxEvent } from '../infrastructure/outbox.repository.js';

export interface TransactionEventInput {
  transactionId: string;
  type: string;
  amount: string;
  currency: string;
  occurredAt: string;
  entries: Array<{ accountId: string; direction: string; amount: string }>;
  reversesId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(private readonly events: OutboxRepository) {}

  async emitTransactionEvent(input: TransactionEventInput): Promise<string> {
    const event: OutboxEventInput = {
      aggregateType: 'transaction',
      aggregateId: input.transactionId,
      eventType: eventTypeForTransaction(input.type),
      payload: transactionEventPayload(input) as unknown as Record<string, unknown>,
    };

    return this.events.emit(event);
  }

  async findForTransaction(transactionId: string): Promise<OutboxEvent[]> {
    return this.events.findByAggregate(transactionId);
  }

  async stats(): Promise<Awaited<ReturnType<OutboxRepository['stats']>>> {
    return this.events.stats();
  }
}
