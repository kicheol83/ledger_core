import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

@Module({
  providers: [RequestLoggingMiddleware],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
