import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { TransactionManager } from './transaction.manager';

class FakeClient extends EventEmitter {
  readonly statements: string[] = [];
  readonly release = vi.fn();
  failNext: Error | null = null;

  query(sql: string): Promise<{ rows: unknown[] }> {
    this.statements.push(sql);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    return Promise.resolve({ rows: [] });
  }
}

function managerWith(client: FakeClient): TransactionManager {
  const pool = {
    connect: () => Promise.resolve(client as unknown as PoolClient),
  } as unknown as Pool;
  return new TransactionManager(pool);
}

describe('TransactionManager', () => {
  it('commits and returns a healthy connection to the pool', async () => {
    const client = new FakeClient();
    const result = await managerWith(client).run(async () => 'ok');

    expect(result).toBe('ok');
    expect(client.statements).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'COMMIT']);
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('survives the connection dropping mid-transaction and discards the client', async () => {
    const client = new FakeClient();
    const lost = new Error('Connection terminated unexpectedly');

    const outcome = managerWith(client).run(async (executor) => {
      client.emit('error', lost);
      client.failNext = lost;
      await executor.query('SELECT 1');
      return 'unreachable';
    });

    await expect(outcome).rejects.toThrow('Connection terminated unexpectedly');
    expect(client.release).toHaveBeenCalledWith(lost);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('keeps the client when PostgreSQL rejects a statement with an SQLSTATE', async () => {
    const client = new FakeClient();
    const violation = Object.assign(new Error('violates check constraint'), { code: '23514' });

    const outcome = managerWith(client).run(async (executor) => {
      client.failNext = violation;
      await executor.query('INSERT INTO t VALUES (1)');
    });

    await expect(outcome).rejects.toThrow('violates check constraint');
    expect(client.statements).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(undefined);
  });
});
