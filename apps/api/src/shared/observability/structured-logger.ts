import type { LoggerService, LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_ORDER: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const REDACTED_KEYS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'signature',
  'email',
];

const REDACTED = '[redacted]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        REDACTED_KEYS.some((needle) => key.toLowerCase().includes(needle))
          ? REDACTED
          : redact(entry, depth + 1),
      ]),
    );
  }

  return value;
}

export class StructuredLogger implements LoggerService {
  constructor(
    private readonly level: Level = 'info',
    private readonly service = 'ledgercore-api',
  ) {}

  log(message: unknown, context?: unknown): void {
    this.emit('info', message, context);
  }

  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.emit('error', message, context, typeof stack === 'string' ? stack : undefined);
  }

  warn(message: unknown, context?: unknown): void {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: unknown): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: unknown): void {
    this.emit('trace', message, context);
  }

  setLogLevels?(_levels: LogLevel[]): void {}

  private emit(level: Level, message: unknown, context?: unknown, stack?: string): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) {
      return;
    }

    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message: typeof message === 'string' ? message : JSON.stringify(redact(message)),
    };

    const requestId = currentRequestId();
    if (requestId) {
      record['requestId'] = requestId;
    }

    if (typeof context === 'string') {
      record['context'] = context;
    } else if (context !== undefined) {
      record['context'] = redact(context);
    }

    if (stack) {
      record['stack'] = stack;
    }

    const line = JSON.stringify(record);

    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
