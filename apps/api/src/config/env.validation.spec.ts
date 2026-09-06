import { describe, expect, it } from 'vitest';
import { EnvValidationError, validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgres://ledger:secret@localhost:5432/ledgercore',
  REDIS_URL: 'redis://localhost:6379',
} satisfies NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('applies defaults for everything optional', () => {
    const env = validateEnv({ ...valid });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_POOL_MAX).toBe(20);
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(5_000);
  });

  it('coerces numeric strings into numbers', () => {
    const env = validateEnv({ ...valid, PORT: '8080', DATABASE_POOL_MAX: '50' });

    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(50);
    expect(typeof env.DATABASE_POOL_MAX).toBe('number');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(EnvValidationError);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /postgres:\/\//,
    );
  });

  it('rejects a pool size above the postgres connection ceiling', () => {
    expect(() => validateEnv({ ...valid, DATABASE_POOL_MAX: '500' })).toThrow(EnvValidationError);
  });

  it('rejects a non-numeric port', () => {
    expect(() => validateEnv({ ...valid, PORT: 'eighty' })).toThrow(EnvValidationError);
  });

  it('reports every problem at once', () => {
    let message = '';
    try {
      validateEnv({ DATABASE_URL: 'not-a-url', REDIS_URL: 'also-wrong', PORT: 'nope' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('REDIS_URL');
    expect(message).toContain('PORT');
  });

  describe('production guards', () => {
    it('refuses to run in production against a _test database', () => {
      expect(() =>
        validateEnv({
          ...valid,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://ledger:secret@db.internal:5432/ledgercore_test',
        }),
      ).toThrow(/database whose name ends in _test/);
    });

    it('refuses trace logging in production', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'production', LOG_LEVEL: 'trace' })).toThrow(
        /trace logging in production/,
      );
    });

    it('allows a _test database outside production', () => {
      expect(() =>
        validateEnv({
          ...valid,
          NODE_ENV: 'test',
          DATABASE_URL: 'postgres://ledger:secret@localhost:5432/ledgercore_test',
        }),
      ).not.toThrow();
    });
  });
});
