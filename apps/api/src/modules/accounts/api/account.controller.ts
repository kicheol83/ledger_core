import { Body, Controller, Get, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../../../shared/validation/zod-validation.pipe';
import { AccountService } from '../application/account.service';
import {
  accountIdParamSchema,
  type AccountResponse,
  createAccountSchema,
  createUserSchema,
  listAccountsQuerySchema,
  toAccountResponse,
  updateStatusSchema,
  type CreateAccountDto,
  type CreateUserDto,
  type UpdateStatusDto,
} from './account.dto';

@Controller('accounts')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createAccountSchema))
  async create(@Body() body: CreateAccountDto): Promise<AccountResponse> {
    const account = await this.accounts.createAccount(body.userId, body.currency);
    return toAccountResponse(account);
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(listAccountsQuerySchema)) query: { userId: string },
  ): Promise<{ accounts: AccountResponse[] }> {
    const accounts = await this.accounts.listAccounts(query.userId);
    return { accounts: accounts.map(toAccountResponse) };
  }

  @Get(':id')
  async get(
    @Param(new ZodValidationPipe(accountIdParamSchema)) params: { id: string },
  ): Promise<AccountResponse> {
    const account = await this.accounts.getAccount(params.id);
    return toAccountResponse(account);
  }

  @Patch(':id/status')
  async setStatus(
    @Param(new ZodValidationPipe(accountIdParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateStatusSchema)) body: UpdateStatusDto,
  ): Promise<AccountResponse> {
    const account = await this.accounts.setStatus(params.id, body.status);
    return toAccountResponse(account);
  }
}

@Controller('users')
export class UserController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createUserSchema))
  async create(
    @Body() body: CreateUserDto,
  ): Promise<{ id: string; email: string; createdAt: string }> {
    return this.accounts.createUser(body.email);
  }
}
