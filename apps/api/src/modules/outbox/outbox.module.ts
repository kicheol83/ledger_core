import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config.js';
import { EVENT_PUBLISHER, OutboxWorker } from './application/outbox-worker.service.js';
import { OutboxService } from './application/outbox.service.js';
import { OutboxController } from './api/outbox.controller.js';
import { OutboxRepository } from './infrastructure/outbox.repository.js';
import { WebhookPublisher } from './infrastructure/webhook.publisher.js';

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
