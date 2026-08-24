import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);

const positiveInt = (max: number): z.ZodNumber => z.coerce.number().int().positive().max(max);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
        message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
      }),

    DATABASE_POOL_MAX: positiveInt(100).default(20),

    DATABASE_STATEMENT_TIMEOUT_MS: positiveInt(60_000).default(5_000),

    REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'REDIS_URL must be a redis:// or rediss:// connection string',
      }),

    IDEMPOTENCY_TTL_HOURS: positiveInt(720).default(24),
    OUTBOX_BATCH_SIZE: positiveInt(1_000).default(100),
    OUTBOX_POLL_INTERVAL_MS: positiveInt(60_000).default(1_000),

    OUTBOX_WEBHOOK_URL: z.string().url().optional(),

    OUTBOX_WEBHOOK_SECRET: z.string().min(16).optional(),

    OUTBOX_DELIVERY_TIMEOUT_MS: positiveInt(30_000).default(5_000),

    OUTBOX_MAX_ATTEMPTS: positiveInt(20).default(8),

    OUTBOX_LEASE_MS: positiveInt(300_000).default(30_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && /_test(\?|$)/.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'refusing to run in production against a database whose name ends in _test',
      });
    }

    if (env.OUTBOX_LEASE_MS <= env.OUTBOX_DELIVERY_TIMEOUT_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OUTBOX_LEASE_MS'],
        message:
          'lease must be longer than the delivery timeout, otherwise a second worker can claim an event still being delivered',
      });
    }

    if (env.NODE_ENV === 'production' && env.OUTBOX_WEBHOOK_URL && !env.OUTBOX_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OUTBOX_WEBHOOK_SECRET'],
        message: 'unsigned webhooks in production allow anyone who learns the URL to forge events',
      });
    }

    if (env.NODE_ENV === 'production' && env.LOG_LEVEL === 'trace') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOG_LEVEL'],
        message: 'trace logging in production writes request payloads to disk',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    super(`Invalid environment configuration:\n${details}`);
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }

  return result.data;
}
