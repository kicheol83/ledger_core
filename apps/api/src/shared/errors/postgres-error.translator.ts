import type { DatabaseError } from 'pg';
import { DomainError } from './domain.error.js';
import {
  AlreadyReversedError,
  ConcurrentModificationError,
  LedgerInvariantViolationError,
} from './ledger.errors.js';

const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
} as const;

function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && typeof (error as DatabaseError).code === 'string';
}

export function translatePostgresError(error: unknown): unknown {
  if (error instanceof DomainError) {
    return error;
  }

  if (!isDatabaseError(error)) {
    return error;
  }

  switch (error.code) {
    case SQLSTATE.UNIQUE_VIOLATION:
      return translateUniqueViolation(error);

    case SQLSTATE.CHECK_VIOLATION:
      return new LedgerInvariantViolationError(error.constraint ?? error.message.slice(0, 200));

    case SQLSTATE.SERIALIZATION_FAILURE:
    case SQLSTATE.DEADLOCK_DETECTED:
      return new ConcurrentModificationError('ledger');

    case SQLSTATE.LOCK_NOT_AVAILABLE:
      return new ConcurrentModificationError('account');

    case SQLSTATE.QUERY_CANCELED:
      return error;

    default:
      return error;
  }
}

function translateUniqueViolation(error: DatabaseError): unknown {
  switch (error.constraint) {
    case 'transactions_one_reversal_per_original':
      return new AlreadyReversedError(extractIdFromDetail(error.detail) ?? 'unknown');

    default:
      return error;
  }
}

function extractIdFromDetail(detail: string | undefined): string | undefined {
  if (!detail) {
    return undefined;
  }
  const match = /\)=\(([^)]+)\)/.exec(detail);
  return match?.[1];
}
