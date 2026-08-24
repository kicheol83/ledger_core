import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL, type Executor } from './executor.js';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  isolation?: IsolationLevel;

  readOnly?: boolean;

  maxRetries?: number;
}

const RETRYABLE_CODES = new Set(['40001', '40P01']);

interface TransactionContext {
  client: PoolClient;
  depth: number;
}

@Injectable()
export class TransactionManager {
  private readonly logger = new Logger(TransactionManager.name);

  private readonly storage = new AsyncLocalStorage<TransactionContext>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  get executor(): Executor {
    return this.storage.getStore()?.client ?? this.pool;
  }

  get inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  async run<T>(
    fn: (executor: Executor) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const existing = this.storage.getStore();

    if (existing) {
      if (options.isolation) {
        throw new Error(
          'cannot change isolation level inside an existing transaction; ' +
            'set it on the outermost run() call',
        );
      }
      return fn(existing.client);
    }

    return this.runNew(fn, options);
  }

  private async runNew<T>(
    fn: (executor: Executor) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    let attempt = 0;

    for (;;) {
      attempt += 1;

      try {
        return await this.attempt(fn, options);
      } catch (error) {
        const code = (error as { code?: string }).code;

        if (!code || !RETRYABLE_CODES.has(code) || attempt > maxRetries) {
          throw error;
        }

        const backoffMs = Math.min(2 ** attempt * 10, 200) * (0.5 + Math.random());

        this.logger.warn(
          `transaction failed with ${code}, retrying (attempt ${attempt}/${maxRetries}) ` +
            `after ${Math.round(backoffMs)}ms`,
        );

        await sleep(backoffMs);
      }
    }
  }

  private async attempt<T>(
    fn: (executor: Executor) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      const isolation = options.isolation ?? 'READ COMMITTED';
      const mode = options.readOnly ? ' READ ONLY' : '';
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}${mode}`);

      let result: T;
      try {
        result = await this.storage.run({ client, depth: 1 }, () => fn(client));
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: Error) => {
          this.logger.error(`rollback failed: ${rollbackError.message}`);
        });
        throw error;
      }

      await client.query('COMMIT');
      return result;
    } finally {
      client.release();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
