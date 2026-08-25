export abstract class DomainError extends Error {
  abstract readonly code: string;

  abstract readonly httpStatus: number;

  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = Object.freeze({ ...details });

    Object.setPrototypeOf(this, new.target.prototype);

    Error.captureStackTrace?.(this, new.target);
  }
}

export abstract class ConcurrencyError extends DomainError {
  readonly retryable = true;
}
