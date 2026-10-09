import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../src/config/app.config';
import { validateEnv } from '../../src/config/env.validation';
import { DatabaseTimeoutError } from '../../src/shared/errors/ledger.errors';
import { translatePostgresError } from '../../src/shared/errors/postgres-error.translator';

const config = new AppConfig(validateEnv(process.env));

const pool = new pg.Pool({
  connectionString: config.database.url,
  max: 1,
  connectionTimeoutMillis: 100,
});

afterAll(async () => {
  await pool.end();
});

describe('database timeouts', () => {
  it('translates a real statement timeout into DatabaseTimeoutError', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '50ms'`);

      const error = await client.query('SELECT pg_sleep(1)').catch((caught: unknown) => caught);

      await client.query('ROLLBACK');

      expect((error as { code?: string }).code).toBe('57014');
      expect(translatePostgresError(error)).toBeInstanceOf(DatabaseTimeoutError);
    } finally {
      client.release();
    }
  });

  it('translates a real pool checkout timeout into DatabaseTimeoutError', async () => {
    const held = await pool.connect();

    try {
      const error = await pool.connect().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(translatePostgresError(error)).toBeInstanceOf(DatabaseTimeoutError);
    } finally {
      held.release();
    }
  });
});
