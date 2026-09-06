import { ConcurrencyError, DomainError } from './domain.error';

export class AccountNotFoundError extends DomainError {
  readonly code = 'ACCOUNT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(accountId: string) {
    super(`account ${accountId} does not exist`, { accountId });
  }
}

export class AccountNotActiveError extends DomainError {
  readonly code = 'ACCOUNT_NOT_ACTIVE';
  readonly httpStatus = 409;

  constructor(accountId: string, status: string) {
    super(`account ${accountId} is ${status.toLowerCase()} and cannot be used`, {
      accountId,
      status,
    });
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';
  readonly httpStatus = 422;

  constructor(accountId: string, available: bigint, requested: bigint, currency: string) {
    super(`account ${accountId} has insufficient funds`, {
      accountId,
      currency,

      available: available.toString(),
      requested: requested.toString(),
      shortfall: (requested - available).toString(),
    });
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
  readonly httpStatus = 422;

  constructor(expected: string, actual: string) {
    super(`expected ${expected} but the account holds ${actual}`, { expected, actual });
  }
}

export class SameAccountTransferError extends DomainError {
  readonly code = 'SAME_ACCOUNT_TRANSFER';
  readonly httpStatus = 422;

  constructor(accountId: string) {
    super('cannot transfer to the same account', { accountId });
  }
}

export class TransactionNotFoundError extends DomainError {
  readonly code = 'TRANSACTION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(transactionId: string) {
    super(`transaction ${transactionId} does not exist`, { transactionId });
  }
}

export class TransactionNotReversibleError extends DomainError {
  readonly code = 'TRANSACTION_NOT_REVERSIBLE';
  readonly httpStatus = 409;

  constructor(transactionId: string, reason: string) {
    super(`transaction ${transactionId} cannot be reversed: ${reason}`, {
      transactionId,
      reason,
    });
  }
}

export class AlreadyReversedError extends DomainError {
  readonly code = 'ALREADY_REVERSED';
  readonly httpStatus = 409;

  constructor(transactionId: string) {
    super(`transaction ${transactionId} has already been reversed`, { transactionId });
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly httpStatus = 422;

  constructor(key: string) {
    super(`idempotency key ${key} was already used with a different request`, { key });
  }
}

export class IdempotentRequestInFlightError extends ConcurrencyError {
  readonly code = 'REQUEST_IN_FLIGHT';
  readonly httpStatus = 409;

  constructor(key: string) {
    super(`a request with idempotency key ${key} is currently being processed`, { key });
  }
}

export class ConcurrentModificationError extends ConcurrencyError {
  readonly code = 'CONCURRENT_MODIFICATION';
  readonly httpStatus = 409;

  constructor(resource: string) {
    super(`${resource} was modified concurrently; retry the request`, { resource });
  }
}

export class LedgerInvariantViolationError extends DomainError {
  readonly code = 'LEDGER_INVARIANT_VIOLATION';
  readonly httpStatus = 500;

  constructor(detail: string) {
    super('the ledger rejected this operation', { detail });
  }
}
