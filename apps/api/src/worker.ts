import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { AppConfig } from './config/app.config';
import { Module } from '@nestjs/common';
import { OutboxWorker } from './modules/outbox/application/outbox-worker.service';
import { OutboxModule } from './modules/outbox/outbox.module';
import { DatabaseModule } from './shared/database/database.module';
import { StructuredLogger } from './shared/observability/structured-logger';

@Module({
  imports: [ConfigModule, DatabaseModule, OutboxModule],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const logger = new Logger('worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const config = app.get(AppConfig);
  app.useLogger(
    new StructuredLogger(
      config.logLevel === 'fatal' ? 'error' : config.logLevel,
      'ledgercore-worker',
    ),
  );
  app.enableShutdownHooks();

  const worker = app.get(OutboxWorker);
  worker.start();

  logger.log(`outbox worker running against ${config.describe()['databaseHost']}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, draining`);
    await worker.stop();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
