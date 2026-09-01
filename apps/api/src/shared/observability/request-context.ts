import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: bigint;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function resolveRequestId(inbound: unknown): string {
  if (typeof inbound === 'string') {
    const cleaned = inbound.replace(/[^\w.:-]/g, '').slice(0, 128);
    if (cleaned.length >= 8) {
      return cleaned;
    }
  }

  return randomUUID();
}
