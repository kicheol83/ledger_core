import { Logger } from '@nestjs/common';
import pg, { type Pool, type PoolConfig } from 'pg';
import type { AppConfig } from '../../config/app.config.js';

const { Pool: PgPool, types } = pg;

function configureTypeParsers(): void {
  types.setTypeParser(types.builtins.INT8, (value: string) => value);

  types.setTypeParser(types.builtins.NUMERIC, (value: string) => value);

  types.setTypeParser(types.builtins.TIMESTAMPTZ, (value: string) => value);
}

export function createPool(config: AppConfig): Pool {
  configureTypeParsers();

  const logger = new Logger('PgPool');
  const { url, poolMax, statementTimeoutMs } = config.database;

  const options: PoolConfig = {
    connectionString: url,
    max: poolMax,

    connectionTimeoutMillis: 5_000,

    idleTimeoutMillis: 30_000,

    options: [
      `-c statement_timeout=${statementTimeoutMs}`,
      `-c idle_in_transaction_session_timeout=${statementTimeoutMs * 2}`,
      `-c application_name=ledgercore-api`,
    ].join(' '),
  };

  const pool = new PgPool(options);

  pool.on('error', (error: Error) => {
    logger.error(`idle client error: ${error.message}`, error.stack);
  });

  return pool;
}
