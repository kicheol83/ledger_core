import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config.js';
import type { OutboxEvent } from './outbox.repository.js';

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

export interface EventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

@Injectable()
export class WebhookPublisher implements EventPublisher {
  private readonly logger = new Logger(WebhookPublisher.name);

  constructor(private readonly config: AppConfig) {}

  async publish(event: OutboxEvent): Promise<void> {
    const { webhookUrl, webhookSecret, deliveryTimeoutMs } = this.config.outbox;

    if (!webhookUrl) {
      throw new DeliveryError('no webhook URL configured', true);
    }

    const body = JSON.stringify({
      id: event.id,
      type: event.eventType,
      aggregateId: event.aggregateId,
      occurredAt: event.createdAt,
      data: event.payload,
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',

      'x-event-id': event.id,
      'x-event-type': event.eventType,
      'x-delivery-attempt': String(event.attempts + 1),
    };

    if (webhookSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      headers['x-signature-timestamp'] = timestamp;

      headers['x-signature'] = sign(webhookSecret, `${timestamp}.${body}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deliveryTimeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        return;
      }

      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429 &&
        response.status !== 408;

      throw new DeliveryError(
        `webhook responded ${response.status} ${response.statusText}`,
        permanent,
      );
    } catch (error) {
      if (error instanceof DeliveryError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new DeliveryError(`delivery timed out after ${deliveryTimeoutMs}ms`, false);
      }

      throw new DeliveryError(`delivery failed: ${(error as Error).message}`, false);
    } finally {
      clearTimeout(timer);
    }
  }
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifySignature(params: {
  secret: string;
  timestamp: string;
  body: string;
  signature: string;
  toleranceSeconds?: number;
}): boolean {
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(params.timestamp));

  if (!Number.isFinite(age) || age > (params.toleranceSeconds ?? 300)) {
    return false;
  }

  const expected = sign(params.secret, `${params.timestamp}.${params.body}`);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(params.signature, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
