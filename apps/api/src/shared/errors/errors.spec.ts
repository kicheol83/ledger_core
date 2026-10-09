import { describe, expect, it } from 'vitest';
import { ConcurrencyError, DomainError } from './domain.error';
import {
  AccountNotFoundError,
  AlreadyReversedError,
  ConcurrentModificationError,
  DatabaseTimeoutError,
  IdempotentRequestInFlightError,
  InsufficientFundsError,
  LedgerInvariantViolationError,
} from './ledger.errors';
import { translatePostgresError } from './postgres-error.translator';

function pgError(code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('postgres said no'), { code, ...extra });
}

describe('DomainError', () => {
  it('preserves instanceof across the hierarchy', () => {
    const error = new AccountNotFoundError('acc-1');

    expect(error).toBeInstanceOf(AccountNotFoundError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
  });

  it('names itself after the concrete subclass', () => {
    expect(new AccountNotFoundError('acc-1').name).toBe('AccountNotFoundError');
  });

  it('freezes details so a handler cannot mutate them', () => {
    const error = new AccountNotFoundError('acc-1');

    expect(() => {
      (error.details as Record<string, unknown>)['accountId'] = 'tampered';
    }).toThrow();
  });

  it('marks concurrency errors as retryable', () => {
    const error = new IdempotentRequestInFlightError('key-1');

    expect(error).toBeInstanceOf(ConcurrencyError);
    expect(error.retryable).toBe(true);
  });
});

describe('InsufficientFundsError', () => {
  it('serialises amounts as strings', () => {
    const error = new InsufficientFundsError('acc-1', 1_000n, 5_000n, 'UZS');

    expect(error.details['available']).toBe('1000');
    expect(error.details['requested']).toBe('5000');
    expect(error.details['shortfall']).toBe('4000');
  });

  it('survives amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n;
    const error = new InsufficientFundsError('acc-1', 0n, huge, 'UZS');

    expect(error.details['requested']).toBe('9007199254740993');
  });

  it('maps to 422, not 400', () => {
    expect(new InsufficientFundsError('acc-1', 0n, 1n, 'UZS').httpStatus).toBe(422);
  });
});

describe('translatePostgresError', () => {
  it('passes through an error that is already a domain error', () => {
    const original = new AccountNotFoundError('acc-1');
    expect(translatePostgresError(original)).toBe(original);
  });

  it('passes through a plain error untouched', () => {
    const original = new Error('something unrelated');
    expect(translatePostgresError(original)).toBe(original);
  });

  it('maps the reversal unique index to AlreadyReversedError', () => {
    const translated = translatePostgresError(
      pgError('23505', {
        constraint: 'transactions_one_reversal_per_original',
        detail: 'Key (reverses_id)=(abc-123) already exists.',
      }),
    );

    expect(translated).toBeInstanceOf(AlreadyReversedError);
    expect((translated as AlreadyReversedError).details['transactionId']).toBe('abc-123');
  });

  it('tolerates a unique violation with no parseable detail', () => {
    const translated = translatePostgresError(
      pgError('23505', { constraint: 'transactions_one_reversal_per_original' }),
    );

    expect(translated).toBeInstanceOf(AlreadyReversedError);
  });

  it('leaves an unrecognised unique violation alone', () => {
    const original = pgError('23505', { constraint: 'users_email_key' });
    expect(translatePostgresError(original)).toBe(original);
  });

  it('maps a check violation to an invariant violation', () => {
    const translated = translatePostgresError(
      pgError('23514', { constraint: 'transactions_amount_positive' }),
    );

    expect(translated).toBeInstanceOf(LedgerInvariantViolationError);
    expect((translated as LedgerInvariantViolationError).httpStatus).toBe(500);
  });

  it.each([
    ['40001', 'serialization failure'],
    ['40P01', 'deadlock'],
  ])('maps %s (%s) to a retryable concurrency error', (code) => {
    const translated = translatePostgresError(pgError(code));

    expect(translated).toBeInstanceOf(ConcurrentModificationError);
    expect((translated as ConcurrentModificationError).retryable).toBe(true);
  });

  it('maps lock_not_available to a concurrency error', () => {
    expect(translatePostgresError(pgError('55P03'))).toBeInstanceOf(ConcurrentModificationError);
  });

  it('maps query_canceled to a retryable 503', () => {
    const translated = translatePostgresError(pgError('57014'));

    expect(translated).toBeInstanceOf(DatabaseTimeoutError);
    expect((translated as DatabaseTimeoutError).httpStatus).toBe(503);
    expect((translated as DatabaseTimeoutError).retryable).toBe(true);
  });
});
