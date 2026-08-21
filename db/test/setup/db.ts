import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    return await fn(client);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function expectCommitToFail(
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<pg.DatabaseError> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await fn(client);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Expected the failure at COMMIT, but a statement inside the transaction ` +
          `threw first: ${(error as Error).message}`,
      );
    }

    try {
      await client.query('COMMIT');
    } catch (error) {
      return error as pg.DatabaseError;
    }

    throw new Error('Expected COMMIT to fail, but it succeeded');
  });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
