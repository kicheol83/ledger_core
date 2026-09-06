import { Module } from '@nestjs/common';
import { AccountController, UserController } from './api/account.controller';
import { AccountService } from './application/account.service';
import { AccountRepository } from './infrastructure/account.repository';

@Module({
  controllers: [AccountController, UserController],
  providers: [AccountService, AccountRepository],
  exports: [AccountService],
})
export class AccountsModule {}
