import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppConfig } from '../../config/app.config';
import { PG_POOL } from './executor';
import { createPool } from './pg-pool.provider';
import { TransactionManager } from './transaction.manager';

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger('PgPool');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`draining pool (signal: ${signal ?? 'none'})`);
    await this.pool.end();
    this.logger.log('pool closed');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig): Pool => createPool(config),
      inject: [AppConfig],
    },
    TransactionManager,
    PoolLifecycle,
  ],
  exports: [PG_POOL, TransactionManager],
})
export class DatabaseModule {}
