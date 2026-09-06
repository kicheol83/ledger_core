import { describe, expect, it } from 'vitest';
import { AppConfig } from './app.config';
import { validateEnv } from './env.validation';

function configFrom(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return new AppConfig(
    validateEnv({
      DATABASE_URL: 'postgres://ledger:supersecret@db.internal:5432/ledgercore',
      REDIS_URL: 'redis://localhost:6379',
      ...overrides,
    }),
  );
}

describe('AppConfig', () => {
  it('exposes database settings as a group', () => {
    const config = configFrom({ DATABASE_POOL_MAX: '30' });

    expect(config.database.poolMax).toBe(30);
    expect(config.database.statementTimeoutMs).toBe(5_000);
  });

  it('reports the environment', () => {
    expect(configFrom({ NODE_ENV: 'production' }).isProduction).toBe(true);
    expect(configFrom({ NODE_ENV: 'development' }).isProduction).toBe(false);
  });

  describe('describe()', () => {
    it('includes the database host and name', () => {
      const described = configFrom().describe();

      expect(described['databaseHost']).toBe('db.internal:5432');
      expect(described['databaseName']).toBe('ledgercore');
    });

    it('never exposes credentials', () => {
      const described = JSON.stringify(configFrom().describe());

      expect(described).not.toContain('supersecret');
      expect(described).not.toContain('ledger:');
    });
  });
});
