import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, type Observable } from 'rxjs';
import { AppConfig } from '../../../config/app.config';
import { TransactionManager } from '../../../shared/database/transaction.manager';
import { IdempotencyConflictError } from '../../../shared/errors/ledger.errors';
import { hashRequest } from '../domain/request-hash';
import { IdempotencyRepository } from '../infrastructure/idempotency.repository';

const HEADER = 'idempotency-key';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly keys: IdempotencyRepository,
    private readonly transactions: TransactionManager,
    private readonly config: AppConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const key = request.headers[HEADER];

    if (typeof key !== 'string' || key.length === 0) {
      throw new BadRequestException(
        `${HEADER} header is required for this operation; use a UUID or another value unique per logical request`,
      );
    }

    if (key.length < 8 || key.length > 255) {
      throw new BadRequestException(`${HEADER} must be between 8 and 255 characters`);
    }

    const endpoint = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = hashRequest(request.body);

    return from(this.handle({ key, endpoint, requestHash, response, next }));
  }

  private async handle(params: {
    key: string;
    endpoint: string;
    requestHash: string;
    response: Response;
    next: CallHandler;
  }): Promise<unknown> {
    const { key, endpoint, requestHash, response, next } = params;

    return this.transactions.run(async () => {
      const claimed = await this.keys.claim({
        key,
        endpoint,
        requestHash,
        ttlHours: this.config.idempotencyTtlHours,
      });

      if (!claimed) {
        return this.replay({ key, endpoint, requestHash, response });
      }

      const result = await lastValueFrom(next.handle());

      await this.keys.recordResponse({
        key,
        status: response.statusCode,
        body: result,
        transactionId: extractTransactionId(result),
      });

      return result;
    });
  }

  private async replay(params: {
    key: string;
    endpoint: string;
    requestHash: string;
    response: Response;
  }): Promise<unknown> {
    const { key, endpoint, requestHash, response } = params;
    const existing = await this.keys.find(key);

    if (!existing) {
      throw new IdempotencyConflictError(key);
    }

    if (existing.endpoint !== endpoint || existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(key);
    }

    if (existing.responseStatus === null) {
      throw new IdempotencyConflictError(key);
    }

    this.logger.debug(`replaying stored response for idempotency key ${key}`);

    response.status(existing.responseStatus);

    response.setHeader('idempotent-replay', 'true');

    return existing.responseBody;
  }
}

function extractTransactionId(result: unknown): string | null {
  if (result !== null && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function lastValueFrom<T>(observable: Observable<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let last: T | undefined;
    observable.subscribe({
      next: (value) => {
        last = value;
      },
      error: reject,
      complete: () => resolve(last),
    });
  });
}
