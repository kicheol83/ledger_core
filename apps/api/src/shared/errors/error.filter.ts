import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentRequestId } from '../observability/request-context.js';
import { ConcurrencyError, DomainError } from './domain.error.js';
import { translatePostgresError } from './postgres-error.translator.js';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  retryable?: boolean;
  errors?: Record<string, unknown>;
  traceId?: string;
}

const PROBLEM_BASE_URI = 'https://ledgercore.dev/problems';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const error = translatePostgresError(exception);
    const traceId = extractTraceId(request);

    const problem = this.toProblem(error, request, traceId);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${problem.status} ${problem.code} [${traceId}]`,
        error instanceof Error ? error.stack : String(error),
      );
    } else {
      this.logger.debug(
        `${request.method} ${request.url} -> ${problem.status} ${problem.code} [${traceId}]`,
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(error: unknown, request: Request, traceId: string): ProblemDetails {
    if (error instanceof DomainError) {
      const problem: ProblemDetails = {
        type: `${PROBLEM_BASE_URI}/${slug(error.code)}`,
        title: humanise(error.code),
        status: error.httpStatus,

        detail: error.message,
        instance: request.url,
        code: error.code,
        traceId,
      };

      if (Object.keys(error.details).length > 0) {
        problem.errors = error.details;
      }

      if (error instanceof ConcurrencyError) {
        problem.retryable = true;
      }

      return problem;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();

      const problem: ProblemDetails = {
        type: `${PROBLEM_BASE_URI}/${slug(statusCode(status))}`,
        title: humanise(statusCode(status)),
        status,
        detail: typeof body === 'string' ? body : extractMessage(body),
        instance: request.url,
        code: statusCode(status),
        traceId,
      };

      if (typeof body === 'object' && body !== null && 'message' in body) {
        const messages = (body as { message: unknown }).message;
        if (Array.isArray(messages)) {
          problem.errors = { validation: messages };
        }
      }

      return problem;
    }

    return {
      type: `${PROBLEM_BASE_URI}/internal-error`,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred. Quote the trace id when reporting this.',
      instance: request.url,
      code: 'INTERNAL_ERROR',
      traceId,
    };
  }
}

function extractTraceId(request: Request): string {
  const ambient = currentRequestId();
  if (ambient) {
    return ambient;
  }

  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header.replace(/[^\w.:-]/g, '').slice(0, 128);
  }

  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function statusCode(status: number): string {
  return HttpStatus[status] ?? 'ERROR';
}

function slug(code: string): string {
  return code.toLowerCase().replace(/_/g, '-');
}

function humanise(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractMessage(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return 'Request failed';
}
