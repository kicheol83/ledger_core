const BASE = '/v1';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  retryable?: boolean;
  errors?: Record<string, unknown>;
  traceId?: string;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  get retryable(): boolean {
    return this.problem.retryable === true;
  }

  get details(): Record<string, unknown> {
    return this.problem.errors ?? {};
  }

  get traceId(): string | undefined {
    return this.problem.traceId;
  }
}

function toProblem(body: unknown, status: number): ProblemDetails {
  if (body !== null && typeof body === 'object' && 'code' in body && 'detail' in body) {
    return body as ProblemDetails;
  }

  return {
    type: 'about:blank',
    title: 'Request failed',
    status,
    detail:
      status === 0
        ? 'The API did not respond.'
        : `The API returned ${status} with no problem document. It may be starting, or it crashed before it could answer.`,
    code: status >= 500 ? 'UPSTREAM_ERROR' : 'REQUEST_FAILED',
    retryable: status >= 500 || status === 0,
  };
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError({
      type: 'about:blank',
      title: 'Unexpected response',
      status: response.status,
      detail: `The server returned a non-JSON response (${response.status}).`,
      code: 'INVALID_RESPONSE',
    });
  }
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    throw new ApiError({
      type: 'about:blank',
      title: 'Cannot reach the API',
      status: 0,
      detail:
        error instanceof Error && error.message
          ? `The request did not reach the server: ${error.message}`
          : 'The request did not reach the server.',
      code: 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const body = await parse(response);

  if (!response.ok) {
    throw new ApiError(toProblem(body, response.status));
  }

  return body as T;
}

export function get<T>(path: string): Promise<T> {
  return send<T>(path);
}

export interface Envelope<T> {
  body: T;
  status: number;
  replayed: boolean;
}

export async function postWithMeta<T>(
  path: string,
  body: unknown,
  idempotencyKey: string,
): Promise<Envelope<T>> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError({
      type: 'about:blank',
      title: 'Cannot reach the API',
      status: 0,
      detail:
        error instanceof Error && error.message
          ? `The request did not reach the server: ${error.message}`
          : 'The request did not reach the server.',
      code: 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const parsed = await parse(response);

  if (!response.ok) {
    throw new ApiError(toProblem(parsed, response.status));
  }

  return {
    body: parsed as T,
    status: response.status,
    replayed: response.headers.get('idempotent-replay') === 'true',
  };
}

export function post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey ?? newIdempotencyKey(),
    },
    body: JSON.stringify(body),
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return send<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
