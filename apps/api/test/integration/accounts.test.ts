import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PG_POOL } from '../../src/shared/database/executor';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';
import type { Pool } from 'pg';

describe('Accounts API', () => {
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
    await pool.query('SELECT test_reset_ledger()');
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function createUser(
    email = `u${Date.now()}${Math.random()}@example.test`,
  ): Promise<string> {
    const response = await http().post('/users').send({ email }).expect(201);
    return response.body.id;
  }

  describe('POST /users', () => {
    it('creates a user', async () => {
      const response = await http().post('/users').send({ email: 'new@example.test' }).expect(201);

      expect(response.body).toMatchObject({ email: 'new@example.test' });
      expect(response.body.id).toBeTruthy();
    });

    it('normalises the email to lowercase', async () => {
      const response = await http()
        .post('/users')
        .send({ email: 'MiXeD@Example.Test' })
        .expect(201);

      expect(response.body.email).toBe('mixed@example.test');
    });

    it('rejects a duplicate email', async () => {
      await http().post('/users').send({ email: 'dup@example.test' }).expect(201);

      await http().post('/users').send({ email: 'dup@example.test' }).expect(409);
    });

    it('rejects a malformed email', async () => {
      const response = await http().post('/users').send({ email: 'not-an-email' }).expect(400);

      expect(response.headers['content-type']).toContain('application/problem+json');
    });

    it('rejects unknown fields rather than ignoring them', async () => {
      await http().post('/users').send({ email: 'extra@example.test', role: 'admin' }).expect(400);
    });
  });

  describe('POST /accounts', () => {
    it('creates an account', async () => {
      const userId = await createUser();

      const response = await http().post('/accounts').send({ userId, currency: 'UZS' }).expect(201);

      expect(response.body).toMatchObject({
        userId,
        currency: 'UZS',
        type: 'USER',
        status: 'ACTIVE',
      });
    });

    it('never exposes a balance field', async () => {
      const userId = await createUser();
      const response = await http().post('/accounts').send({ userId, currency: 'UZS' });

      expect(response.body).not.toHaveProperty('balance');
    });

    it('rejects a currency outside the registry', async () => {
      const userId = await createUser();

      await http().post('/accounts').send({ userId, currency: 'ZZZ' }).expect(400);
    });

    it('rejects a lowercase currency code', async () => {
      const userId = await createUser();

      await http().post('/accounts').send({ userId, currency: 'uzs' }).expect(400);
    });

    it('returns 404 for a nonexistent user', async () => {
      await http()
        .post('/accounts')
        .send({ userId: '00000000-0000-0000-0000-000000000000', currency: 'UZS' })
        .expect(404);
    });

    it('rejects a non-uuid user id', async () => {
      await http().post('/accounts').send({ userId: 'not-a-uuid', currency: 'UZS' }).expect(400);
    });

    it('allows multiple accounts per user in different currencies', async () => {
      const userId = await createUser();

      await http().post('/accounts').send({ userId, currency: 'UZS' }).expect(201);
      await http().post('/accounts').send({ userId, currency: 'KRW' }).expect(201);

      const response = await http().get('/accounts').query({ userId }).expect(200);
      expect(response.body.accounts).toHaveLength(2);
    });
  });

  describe('GET /accounts/:id', () => {
    it('returns the account', async () => {
      const userId = await createUser();
      const created = await http().post('/accounts').send({ userId, currency: 'UZS' });

      const response = await http().get(`/accounts/${created.body.id}`).expect(200);

      expect(response.body.id).toBe(created.body.id);
    });

    it('returns a problem document for a missing account', async () => {
      const response = await http()
        .get('/accounts/00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(response.body.code).toBe('ACCOUNT_NOT_FOUND');
      expect(response.body.errors.accountId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('rejects a malformed id before touching the database', async () => {
      await http().get('/accounts/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /accounts/:id/status', () => {
    it('freezes an account', async () => {
      const userId = await createUser();
      const created = await http().post('/accounts').send({ userId, currency: 'UZS' });

      const response = await http()
        .patch(`/accounts/${created.body.id}/status`)
        .send({ status: 'FROZEN' })
        .expect(200);

      expect(response.body.status).toBe('FROZEN');
    });

    it('rejects an invalid status', async () => {
      const userId = await createUser();
      const created = await http().post('/accounts').send({ userId, currency: 'UZS' });

      await http()
        .patch(`/accounts/${created.body.id}/status`)
        .send({ status: 'DELETED' })
        .expect(400);
    });
  });
});
