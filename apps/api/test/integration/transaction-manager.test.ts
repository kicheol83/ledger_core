import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { AppConfig } from '../../src/config/app.config';
import { validateEnv } from '../../src/config/env.validation';
import { createPool } from '../../src/shared/database/pg-pool.provider';
import { TransactionManager } from '../../src/shared/database/transaction.manager';

const config = new AppConfig(validateEnv(process.env));
const pool = createPool(config);
const manager = new TransactionManager(pool);

async function createAccount(): Promise<string> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`tm-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
  );
  const account = await pool.query<{ id: string }>(
    `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
    [user.rows[0]!.id],
  );
  return account.rows[0]!.id;
}

beforeEach(async () => {
  await pool.query('SELECT test_reset_ledger()');
});

afterAll(async () => {
  await pool.end();
});

function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?$/.exec(value.trim());

  if (!match) {
    throw new Error(`unrecognised duration: ${value}`);
  }

  const amount = Number(match[1]);

  switch (match[2]) {
    case 'us':
      return amount / 1000;
    case 'min':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    case 'd':
      return amount * 86_400_000;
    case 's':
      return amount * 1000;
    default:
      return amount;
  }
}

describe('TransactionManager', () => {
  it('commits work performed inside run()', async () => {
    const accountId = await manager.run(async (executor) => {
      const user = await executor.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ('commit@example.test') RETURNING id`,
      );
      const account = await executor.query<{ id: string }>(
        `INSERT INTO accounts (user_id, currency) VALUES ($1, 'UZS') RETURNING id`,
        [user.rows[0]!.id],
      );
      return account.rows[0]!.id;
    });

    const result = await pool.query('SELECT id FROM accounts WHERE id = $1', [accountId]);
    expect(result.rowCount).toBe(1);
  });

  it('rolls back everything when the callback throws', async () => {
    await expect(
      manager.run(async (executor) => {
        await executor.query(`INSERT INTO users (email) VALUES ('rollback@example.test')`);
        throw new Error('business rule violated');
      }),
    ).rejects.toThrow('business rule violated');

    const result = await pool.query(`SELECT id FROM users WHERE email = 'rollback@example.test'`);
    expect(result.rowCount).toBe(0);
  });

  it('surfaces deferred constraint failures raised at COMMIT', async () => {
    const accountId = await createAccount();

    await expect(
      manager.run(async (executor) => {
        const tx = await executor.query<{ id: string }>(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 5000, 'UZS', now()) RETURNING id`,
        );
        await executor.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
           VALUES ($1, $2, 'DEBIT', 5000)`,
          [tx.rows[0]!.id, accountId],
        );
      }),
    ).rejects.toThrow(/minimum is 2/);
  });

  describe('ambient client propagation', () => {
    it('exposes the transaction client through the executor getter', async () => {
      expect(manager.inTransaction).toBe(false);

      await manager.run(async (executor) => {
        expect(manager.inTransaction).toBe(true);
        expect(manager.executor).toBe(executor);
      });

      expect(manager.inTransaction).toBe(false);
    });

    it('makes uncommitted writes visible to the ambient executor', async () => {
      await manager.run(async () => {
        await manager.executor.query(`INSERT INTO users (email) VALUES ('ambient@example.test')`);

        const inside = await manager.executor.query(
          `SELECT id FROM users WHERE email = 'ambient@example.test'`,
        );
        expect(inside.rowCount).toBe(1);

        const outside = await pool.query(
          `SELECT id FROM users WHERE email = 'ambient@example.test'`,
        );
        expect(outside.rowCount).toBe(0);
      });
    });

    it('falls back to the pool outside a transaction', async () => {
      const result = await manager.executor.query('SELECT 1 AS value');
      expect(result.rows[0]).toEqual({ value: 1 });
    });
  });

  describe('nesting', () => {
    it('joins an existing transaction rather than opening a nested one', async () => {
      await manager
        .run(async (outer) => {
          await manager.run(async (inner) => {
            expect(inner).toBe(outer);
            await inner.query(`INSERT INTO users (email) VALUES ('nested@example.test')`);
          });

          throw new Error('outer fails');
        })
        .catch(() => undefined);

      const result = await pool.query(`SELECT id FROM users WHERE email = 'nested@example.test'`);
      expect(result.rowCount).toBe(0);
    });

    it('rejects an isolation level on a joined transaction', async () => {
      await expect(
        manager.run(async () => {
          await manager.run(async () => undefined, { isolation: 'SERIALIZABLE' });
        }),
      ).rejects.toThrow(/cannot change isolation level/);
    });
  });

  describe('isolation levels', () => {
    it('applies the requested level', async () => {
      const level = await manager.run(
        async (executor) => {
          const result = await executor.query<{ transaction_isolation: string }>(
            'SHOW transaction_isolation',
          );
          return result.rows[0]!.transaction_isolation;
        },
        { isolation: 'SERIALIZABLE' },
      );

      expect(level).toBe('serializable');
    });

    it('defaults to read committed', async () => {
      const level = await manager.run(async (executor) => {
        const result = await executor.query<{ transaction_isolation: string }>(
          'SHOW transaction_isolation',
        );
        return result.rows[0]!.transaction_isolation;
      });

      expect(level).toBe('read committed');
    });

    it('refuses writes in a read-only transaction', async () => {
      await expect(
        manager.run(
          async (executor) => {
            await executor.query(`INSERT INTO users (email) VALUES ('readonly@example.test')`);
          },
          { readOnly: true },
        ),
      ).rejects.toThrow(/read-only transaction/);
    });
  });

  describe('retry behaviour', () => {
    it('retries a serialization failure and succeeds', async () => {
      const accountId = await createAccount();
      let attempts = 0;

      const other = new pg.Pool({ connectionString: config.database.url, max: 1 });

      try {
        const result = await manager.run(
          async (executor) => {
            attempts += 1;

            await executor.query('SELECT count(*) FROM ledger_entries WHERE account_id = $1', [
              accountId,
            ]);

            if (attempts === 1) {
              await other.query(`INSERT INTO users (email) VALUES ($1)`, [
                `conflict-${Date.now()}@example.test`,
              ]);
              const error = new Error('could not serialize access') as Error & { code: string };
              error.code = '40001';
              throw error;
            }

            return 'ok';
          },
          { isolation: 'SERIALIZABLE' },
        );

        expect(result).toBe('ok');
        expect(attempts).toBe(2);
      } finally {
        await other.end();
      }
    });

    it('gives up after maxRetries and rethrows', async () => {
      let attempts = 0;

      await expect(
        manager.run(
          async () => {
            attempts += 1;
            const error = new Error('deadlock detected') as Error & { code: string };
            error.code = '40P01';
            throw error;
          },
          { maxRetries: 2 },
        ),
      ).rejects.toThrow('deadlock detected');

      expect(attempts).toBe(3);
    });

    it('does not retry a non-retryable error', async () => {
      let attempts = 0;

      await expect(
        manager.run(async (executor) => {
          attempts += 1;
          await executor.query(`INSERT INTO users (email) VALUES ('BAD CASE@example.test')`);
        }),
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });
  });

  describe('connection hygiene', () => {
    it('releases connections on both success and failure', async () => {
      const before = pool.idleCount + pool.totalCount;

      await manager.run(async (executor) => {
        await executor.query('SELECT 1');
      });

      await manager
        .run(async () => {
          throw new Error('boom');
        })
        .catch(() => undefined);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(pool.totalCount).toBeLessThanOrEqual(Math.max(before, config.database.poolMax));
      expect(pool.waitingCount).toBe(0);
    });
  });

  describe('session settings', () => {
    it('applies the configured statement timeout', async () => {
      const result = await pool.query<{ statement_timeout: string }>('SHOW statement_timeout');

      expect(parseDuration(result.rows[0]!.statement_timeout)).toBe(
        config.database.statementTimeoutMs,
      );
    });

    it('identifies itself in pg_stat_activity', async () => {
      const result = await pool.query<{ application_name: string }>('SHOW application_name');
      expect(result.rows[0]!.application_name).toBe('ledgercore-api');
    });
  });

  describe('type parsers', () => {
    it('returns bigint as a string', async () => {
      const result = await pool.query<{ big: string }>(`SELECT 9007199254740993::bigint AS big`);
      expect(result.rows[0]!.big).toBe('9007199254740993');
      expect(typeof result.rows[0]!.big).toBe('string');
    });

    it('returns timestamptz as a string', async () => {
      const result = await pool.query<{ now: string }>('SELECT now() AS now');
      expect(typeof result.rows[0]!.now).toBe('string');
    });
  });
});
