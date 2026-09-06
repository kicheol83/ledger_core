import type { Env } from './env.validation';

export class AppConfig {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get port(): number {
    return this.env.PORT;
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get database(): {
    url: string;
    poolMax: number;
    statementTimeoutMs: number;
  } {
    return {
      url: this.env.DATABASE_URL,
      poolMax: this.env.DATABASE_POOL_MAX,
      statementTimeoutMs: this.env.DATABASE_STATEMENT_TIMEOUT_MS,
    };
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get idempotencyTtlHours(): number {
    return this.env.IDEMPOTENCY_TTL_HOURS;
  }

  get outbox(): {
    batchSize: number;
    pollIntervalMs: number;
    webhookUrl: string | undefined;
    webhookSecret: string | undefined;
    deliveryTimeoutMs: number;
    maxAttempts: number;
    leaseMs: number;
  } {
    return {
      batchSize: this.env.OUTBOX_BATCH_SIZE,
      pollIntervalMs: this.env.OUTBOX_POLL_INTERVAL_MS,
      webhookUrl: this.env.OUTBOX_WEBHOOK_URL,
      webhookSecret: this.env.OUTBOX_WEBHOOK_SECRET,
      deliveryTimeoutMs: this.env.OUTBOX_DELIVERY_TIMEOUT_MS,
      maxAttempts: this.env.OUTBOX_MAX_ATTEMPTS,
      leaseMs: this.env.OUTBOX_LEASE_MS,
    };
  }

  describe(): Record<string, string | number> {
    const url = new URL(this.env.DATABASE_URL);

    return {
      nodeEnv: this.env.NODE_ENV,
      port: this.env.PORT,
      logLevel: this.env.LOG_LEVEL,
      databaseHost: url.host,
      databaseName: url.pathname.replace(/^\//, ''),
      poolMax: this.env.DATABASE_POOL_MAX,
      statementTimeoutMs: this.env.DATABASE_STATEMENT_TIMEOUT_MS,
    };
  }
}
