import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveRequestId, runWithRequestContext } from './request-context';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('http');

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.headers['x-request-id']);
    const startedAt = process.hrtime.bigint();

    response.setHeader('x-request-id', requestId);

    runWithRequestContext(
      { requestId, method: request.method, path: request.path, startedAt },
      () => {
        response.on('finish', () => {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

          const summary = {
            method: request.method,

            route: request.route?.path ?? request.path,
            status: response.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            idempotentReplay: response.getHeader('idempotent-replay') === 'true' || undefined,
          };

          if (response.statusCode >= 500) {
            this.logger.error(JSON.stringify(summary));
          } else if (response.statusCode >= 400) {
            this.logger.warn(JSON.stringify(summary));
          } else {
            this.logger.log(JSON.stringify(summary));
          }
        });

        next();
      },
    );
  }
}
