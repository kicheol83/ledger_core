import { Module } from '@nestjs/common';
import { AccountController, UserController } from './api/account.controller.js';
import { AccountService } from './application/account.service.js';
import { AccountRepository } from './infrastructure/account.repository.js';

@Module({
  controllers: [AccountController, UserController],
  providers: [AccountService, AccountRepository],
  exports: [AccountService],
})
export class AccountsModule {}
