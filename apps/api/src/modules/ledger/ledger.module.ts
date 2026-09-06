import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { BalanceController } from './api/balance.controller';
import { FundingController } from './api/funding.controller';
import { ReversalController } from './api/reversal.controller';
import { TransferController } from './api/transfer.controller';
import { BalanceService } from './application/balance.service';
import { FundingService } from './application/funding.service';
import { ReversalService } from './application/reversal.service';
import { TransferService } from './application/transfer.service';
import { BalanceRepository } from './infrastructure/balance.repository';
import { TransactionRepository } from './infrastructure/transaction.repository';

@Module({
  imports: [AccountsModule, IdempotencyModule, OutboxModule],
  controllers: [BalanceController, TransferController, FundingController, ReversalController],
  providers: [
    BalanceService,
    TransferService,
    FundingService,
    ReversalService,
    BalanceRepository,
    TransactionRepository,
  ],
  exports: [BalanceService, TransferService, FundingService, ReversalService],
})
export class LedgerModule {}
