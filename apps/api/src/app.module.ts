import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessController } from './health/readiness.controller.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { ObservabilityModule } from './shared/observability/observability.module.js';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    AccountsModule,
    LedgerModule,
    OutboxModule,
  ],
  controllers: [HealthController, ReadinessController],
})
export class AppModule {}
