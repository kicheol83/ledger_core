export const EVENT_TYPES = [
  'transfer.completed',
  'deposit.completed',
  'withdrawal.completed',
  'transaction.reversed',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface OutboxEventInput {
  aggregateType: 'transaction';
  aggregateId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}

export interface TransactionEventPayload {
  transactionId: string;
  type: string;
  amount: string;
  currency: string;
  occurredAt: string;
  entries: Array<{ accountId: string; direction: string; amount: string }>;
  reversesId?: string;
  metadata?: Record<string, unknown>;
}

export function transactionEventPayload(params: {
  transactionId: string;
  type: string;
  amount: string;
  currency: string;
  occurredAt: string;
  entries: Array<{ accountId: string; direction: string; amount: string }>;
  reversesId?: string | null;
  metadata?: Record<string, unknown>;
}): TransactionEventPayload {
  return {
    transactionId: params.transactionId,
    type: params.type,

    amount: params.amount,
    currency: params.currency,
    occurredAt: params.occurredAt,
    entries: params.entries,
    ...(params.reversesId ? { reversesId: params.reversesId } : {}),
    ...(params.metadata && Object.keys(params.metadata).length > 0
      ? { metadata: params.metadata }
      : {}),
  };
}

export function eventTypeForTransaction(type: string): EventType {
  switch (type) {
    case 'TRANSFER':
      return 'transfer.completed';
    case 'DEPOSIT':
      return 'deposit.completed';
    case 'WITHDRAWAL':
      return 'withdrawal.completed';
    case 'REVERSAL':
      return 'transaction.reversed';
    default:
      throw new Error(`no event type mapped for transaction type ${type}`);
  }
}
