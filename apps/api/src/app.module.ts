import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { ReadinessController } from './health/readiness.controller';
import { AccountsModule } from './modules/accounts/accounts.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { DatabaseModule } from './shared/database/database.module';
import { ObservabilityModule } from './shared/observability/observability.module';

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
