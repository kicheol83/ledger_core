import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config.js';
import { TransactionManager } from '../../../shared/database/transaction.manager.js';
import { OutboxRepository, type OutboxEvent } from '../infrastructure/outbox.repository.js';
import { DeliveryError, WebhookPublisher } from '../infrastructure/webhook.publisher.js';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface WorkerRunSummary {
  claimed: number;
  published: number;
  retried: number;
  dead: number;
}

@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<unknown> | undefined;

  constructor(
    private readonly events: OutboxRepository,
    @Inject(EVENT_PUBLISHER) private readonly publisher: WebhookPublisher,
    private readonly transactions: TransactionManager,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    if (!this.config.outbox.webhookUrl) {
      throw new Error('OUTBOX_WEBHOOK_URL is required to run the outbox worker');
    }

    this.running = true;
    this.logger.log(
      `outbox worker started (batch ${this.config.outbox.batchSize}, ` +
        `poll ${this.config.outbox.pollIntervalMs}ms)`,
    );

    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.inFlight;
    this.logger.log('outbox worker stopped');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let summary: WorkerRunSummary;

      try {
        this.inFlight = this.runOnce();
        summary = (await this.inFlight) as WorkerRunSummary;
      } catch (error) {
        this.logger.error(`outbox poll failed: ${(error as Error).message}`);
        await sleep(this.config.outbox.pollIntervalMs);
        continue;
      }

      const idle = summary.claimed === 0;
      await sleep(idle ? this.config.outbox.pollIntervalMs : 0);
    }
  }

  async runOnce(): Promise<WorkerRunSummary> {
    const { batchSize, leaseMs } = this.config.outbox;

    const leased = await this.transactions.run(async () =>
      this.events.leaseDue(batchSize, leaseMs),
    );

    const summary: WorkerRunSummary = {
      claimed: leased.length,
      published: 0,
      retried: 0,
      dead: 0,
    };

    if (leased.length === 0) {
      return summary;
    }

    for (const event of leased) {
      const outcome = await this.deliver(event);
      summary[outcome] += 1;
    }

    return summary;
  }

  private async deliver(event: OutboxEvent): Promise<'published' | 'retried' | 'dead'> {
    try {
      await this.publisher.publish(event);
      await this.transactions.run(async () => this.events.markPublished(event.id));
      return 'published';
    } catch (error) {
      const attempts = event.attempts + 1;
      const permanent = error instanceof DeliveryError && error.permanent;
      const exhausted = attempts >= this.config.outbox.maxAttempts;
      const dead = permanent || exhausted;

      await this.transactions.run(async () =>
        this.events.markFailed({
          id: event.id,
          error: (error as Error).message,
          backoffMs: dead ? 0 : backoffFor(attempts),
          dead,
        }),
      );

      if (dead) {
        this.logger.error(
          `event ${event.id} (${event.eventType}) moved to dead letter after ` +
            `${attempts} attempts: ${(error as Error).message}`,
        );
        return 'dead';
      }

      this.logger.warn(
        `event ${event.id} delivery failed (attempt ${attempts}), retrying: ` +
          `${(error as Error).message}`,
      );
      return 'retried';
    }
  }
}

export function backoffFor(attempt: number): number {
  const base = Math.min(1_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
