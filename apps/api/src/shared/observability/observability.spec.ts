import { describe, expect, it, vi } from 'vitest';
import { currentRequestId, resolveRequestId, runWithRequestContext } from './request-context.js';
import { redact, StructuredLogger } from './structured-logger.js';

describe('resolveRequestId', () => {
  it('reuses a well-formed inbound id', () => {
    expect(resolveRequestId('req-abc-123')).toBe('req-abc-123');
  });

  it('strips characters that could forge a log line', () => {
    const resolved = resolveRequestId('good\n{"level":"error","message":"fake"}');

    expect(resolved).not.toContain('\n');
    expect(resolved).not.toContain('"');
  });

  it('caps the length', () => {
    expect(resolveRequestId('x'.repeat(500)).length).toBeLessThanOrEqual(128);
  });

  it('mints one when the header is missing or too short', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('abc')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('request context', () => {
  it('is visible to anything called within it', () => {
    runWithRequestContext(
      { requestId: 'req-1', method: 'POST', path: '/transfers', startedAt: 0n },
      () => {
        expect(currentRequestId()).toBe('req-1');
      },
    );
  });

  it('survives an await boundary', async () => {
    await runWithRequestContext(
      { requestId: 'req-2', method: 'GET', path: '/balances', startedAt: 0n },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(currentRequestId()).toBe('req-2');
      },
    );
  });

  it('is absent outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });
});

describe('redact', () => {
  it('masks sensitive keys', () => {
    expect(redact({ password: 'hunter2', amount: '5000' })).toEqual({
      password: '[redacted]',
      amount: '5000',
    });
  });

  it('matches case-insensitively and on substrings', () => {
    const result = redact({ Authorization: 'Bearer x', apiKey: 'k', webhookSecret: 's' }) as Record<
      string,
      string
    >;

    expect(result['Authorization']).toBe('[redacted]');
    expect(result['apiKey']).toBe('[redacted]');
    expect(result['webhookSecret']).toBe('[redacted]');
  });

  it('keeps amounts and currencies', () => {
    expect(redact({ amount: '5000', currency: 'UZS' })).toEqual({
      amount: '5000',
      currency: 'UZS',
    });
  });

  it('recurses into nested objects', () => {
    const result = redact({ outer: { token: 'abc', safe: 1 } }) as {
      outer: Record<string, unknown>;
    };

    expect(result.outer['token']).toBe('[redacted]');
    expect(result.outer['safe']).toBe(1);
  });

  it('stops at a bounded depth', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor['next'] = {};
      cursor = cursor['next'] as Record<string, unknown>;
    }

    expect(() => JSON.stringify(redact(deep))).not.toThrow();
  });

  it('truncates long arrays', () => {
    const result = redact(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(result.length).toBeLessThanOrEqual(50);
  });
});

describe('StructuredLogger', () => {
  function capture(
    fn: (logger: StructuredLogger) => void,
    level: 'error' | 'info' | 'debug' = 'info',
  ): Record<string, unknown>[] {
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    fn(new StructuredLogger(level));

    out.mockRestore();
    err.mockRestore();

    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('emits one JSON object per line', () => {
    const records = capture((logger) => logger.log('transfer completed', 'TransferService'));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      message: 'transfer completed',
      context: 'TransferService',
      service: 'ledgercore-api',
    });
  });

  it('includes the ambient request id', () => {
    const records = capture((logger) => {
      runWithRequestContext(
        { requestId: 'req-42', method: 'POST', path: '/transfers', startedAt: 0n },
        () => logger.log('inside a request'),
      );
    });

    expect(records[0]!['requestId']).toBe('req-42');
  });

  it('omits the request id outside a request', () => {
    const records = capture((logger) => logger.log('startup'));
    expect(records[0]).not.toHaveProperty('requestId');
  });

  it('respects the configured level', () => {
    const records = capture((logger) => logger.debug('noise'), 'info');
    expect(records).toHaveLength(0);
  });

  it('writes errors to stderr with the stack', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    new StructuredLogger('error').error('boom', 'Error: boom\n  at x');

    expect(errSpy).toHaveBeenCalledOnce();
    expect(outSpy).not.toHaveBeenCalled();

    const record = JSON.parse(String(errSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(record['stack']).toContain('at x');

    errSpy.mockRestore();
    outSpy.mockRestore();
  });

  it('redacts a structured message', () => {
    const records = capture((logger) => logger.log({ token: 'abc', amount: '100' }));

    expect(records[0]!['message']).toContain('[redacted]');
    expect(records[0]!['message']).toContain('100');
  });

  it('produces parseable output even for a message containing quotes', () => {
    const records = capture((logger) => logger.log('he said "hello"\nand left'));

    expect(records[0]!['message']).toBe('he said "hello"\nand left');
  });
});
