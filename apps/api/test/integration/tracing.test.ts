import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PG_POOL } from '../../src/shared/database/executor.js';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter.js';

describe('Request tracing', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    pool = app.get<Pool>(PG_POOL);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM idempotency_keys');
    await pool.query('SELECT test_reset_ledger()');
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  it('returns a request id on every response', async () => {
    const response = await http().get('/health/live').expect(200);

    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('echoes an inbound request id', async () => {
    const response = await http()
      .get('/health/live')
      .set('x-request-id', 'trace-from-gateway')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('trace-from-gateway');
  });

  it('sanitises an inbound id that could forge log lines', async () => {
    const response = await http()
      .get('/health/live')
      .set('x-request-id', 'abcdefgh"}{"level":"error"')
      .expect(200);

    expect(response.headers['x-request-id']).not.toContain('"');
  });

  it('gives errors the same id as the response header', async () => {
    const response = await http()
      .get('/accounts/00000000-0000-0000-0000-000000000000')
      .set('x-request-id', 'trace-error-case')
      .expect(404);

    expect(response.body.traceId).toBe('trace-error-case');
    expect(response.headers['x-request-id']).toBe('trace-error-case');
  });

  it('gives each request its own id', async () => {
    const first = await http().get('/health/live').expect(200);
    const second = await http().get('/health/live').expect(200);

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('keeps the id stable across a request that touches the database', async () => {
    const user = await http()
      .post('/users')
      .set('x-request-id', randomUUID())
      .send({ email: `trace-${Date.now()}@example.test` })
      .expect(201);

    expect(user.body.id).toBeTruthy();
  });
});
