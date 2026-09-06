import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './api/idempotency.interceptor';
import { IdempotencyRepository } from './infrastructure/idempotency.repository';

@Module({
  providers: [IdempotencyInterceptor, IdempotencyRepository],
  exports: [IdempotencyInterceptor, IdempotencyRepository],
})
export class IdempotencyModule {}
