import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './api/idempotency.interceptor.js';
import { IdempotencyRepository } from './infrastructure/idempotency.repository.js';

@Module({
  providers: [IdempotencyInterceptor, IdempotencyRepository],
  exports: [IdempotencyInterceptor, IdempotencyRepository],
})
export class IdempotencyModule {}
