import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { BalanceController } from './api/balance.controller.js';
import { FundingController } from './api/funding.controller.js';
import { ReversalController } from './api/reversal.controller.js';
import { TransferController } from './api/transfer.controller.js';
import { BalanceService } from './application/balance.service.js';
import { FundingService } from './application/funding.service.js';
import { ReversalService } from './application/reversal.service.js';
import { TransferService } from './application/transfer.service.js';
import { BalanceRepository } from './infrastructure/balance.repository.js';
import { TransactionRepository } from './infrastructure/transaction.repository.js';

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
