import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface Executor {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export type PgExecutor = Pool | PoolClient;

export const PG_POOL = Symbol('PG_POOL');
