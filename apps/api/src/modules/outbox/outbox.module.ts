import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { EVENT_PUBLISHER, OutboxWorker } from './application/outbox-worker.service';
import { OutboxService } from './application/outbox.service';
import { OutboxController } from './api/outbox.controller';
import { OutboxRepository } from './infrastructure/outbox.repository';
import { WebhookPublisher } from './infrastructure/webhook.publisher';

@Module({
  controllers: [OutboxController],
  providers: [
    OutboxService,
    OutboxRepository,
    OutboxWorker,
    {
      provide: EVENT_PUBLISHER,
      useFactory: (config: AppConfig): WebhookPublisher => new WebhookPublisher(config),
      inject: [AppConfig],
    },
  ],
  exports: [OutboxService, OutboxRepository, OutboxWorker, EVENT_PUBLISHER],
})
export class OutboxModule {}
