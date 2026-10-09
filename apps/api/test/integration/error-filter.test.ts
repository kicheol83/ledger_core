import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DomainExceptionFilter } from '../../src/shared/errors/error.filter';
import {
  AccountNotFoundError,
  ConcurrentModificationError,
  InsufficientFundsError,
} from '../../src/shared/errors/ledger.errors';

@Controller('failures')
class FailureController {
  @Get('not-found')
  notFound(): never {
    throw new AccountNotFoundError('acc-42');
  }

  @Get('insufficient-funds')
  insufficientFunds(): never {
    throw new InsufficientFundsError('acc-42', 1_000n, 5_000n, 'UZS');
  }

  @Get('contention')
  contention(): never {
    throw new ConcurrentModificationError('account');
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error('connection string postgres://ledger:hunter2@db.internal/ledgercore leaked');
  }

  @Get('postgres')
  postgres(): never {
    throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
  }

  @Get('statement-timeout')
  statementTimeout(): never {
    throw Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
  }
}

@Module({ controllers: [FailureController] })
class FailureModule {}

describe('DomainExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FailureModule] }).compile();

    app = moduleRef.createNestApplication();

    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns problem+json with a stable code', async () => {
    const response = await request(app.getHttpServer()).get('/failures/not-found');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      status: 404,
      type: 'https://ledgercore.dev/problems/account-not-found',
    });
  });

  it('includes structured details for business failures', async () => {
    const response = await request(app.getHttpServer()).get('/failures/insufficient-funds');

    expect(response.status).toBe(422);
    expect(response.body.errors).toEqual({
      accountId: 'acc-42',
      currency: 'UZS',
      available: '1000',
      requested: '5000',
      shortfall: '4000',
    });
  });

  it('flags concurrency errors as retryable', async () => {
    const response = await request(app.getHttpServer()).get('/failures/contention');

    expect(response.status).toBe(409);
    expect(response.body.retryable).toBe(true);
  });

  it('answers a database timeout with a retryable 503', async () => {
    const response = await request(app.getHttpServer()).get('/failures/statement-timeout');

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('DATABASE_TIMEOUT');
    expect(response.body.retryable).toBe(true);
  });

  it('translates an untranslated postgres error at the boundary', async () => {
    const response = await request(app.getHttpServer()).get('/failures/postgres');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONCURRENT_MODIFICATION');
  });

  describe('unexpected errors', () => {
    it('returns 500 without leaking the message', async () => {
      const response = await request(app.getHttpServer()).get('/failures/unexpected');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('hunter2');
      expect(JSON.stringify(response.body)).not.toContain('postgres://');
    });

    it('returns a trace id the caller can quote', async () => {
      const response = await request(app.getHttpServer()).get('/failures/unexpected');

      expect(response.body.traceId).toBeTruthy();
    });

    it('reuses an inbound x-request-id for correlation', async () => {
      const response = await request(app.getHttpServer())
        .get('/failures/unexpected')
        .set('x-request-id', 'trace-from-gateway');

      expect(response.body.traceId).toBe('trace-from-gateway');
    });
  });

  it('renders framework 404s in the same shape', async () => {
    const response = await request(app.getHttpServer()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.traceId).toBeTruthy();
  });
});
