import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/app.config.js';
import { DomainExceptionFilter } from './shared/errors/error.filter.js';
import { StructuredLogger } from './shared/observability/structured-logger.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(AppConfig);

  app.useLogger(new StructuredLogger(config.logLevel === 'fatal' ? 'error' : config.logLevel));

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new DomainExceptionFilter());

  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(`listening on port ${config.port}`);
  logger.log(JSON.stringify(config.describe()));
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
