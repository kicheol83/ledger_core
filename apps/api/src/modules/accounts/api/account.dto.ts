import { z } from 'zod';
import { currencyCodes } from '../../../shared/money/index';
import type { Account } from '../domain/account';

const uuid = z.string().uuid('must be a UUID');

export const createUserSchema = z
  .object({
    email: z.string().email().max(320).toLowerCase(),
  })
  .strict();

export const createAccountSchema = z
  .object({
    userId: uuid,

    currency: z.enum(currencyCodes() as [string, ...string[]]),
  })
  .strict();

export const accountIdParamSchema = z.object({ id: uuid }).strict();

export const listAccountsQuerySchema = z.object({ userId: uuid }).strict();

export const updateStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'FROZEN', 'CLOSED']),
  })
  .strict();

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;

export interface AccountResponse {
  id: string;
  userId: string | null;
  currency: string;
  type: string;
  status: string;
  createdAt: string;
}

export function toAccountResponse(account: Account): AccountResponse {
  return {
    id: account.id,
    userId: account.userId,
    currency: account.currency,
    type: account.type,
    status: account.status,
    createdAt: account.createdAt,
  };
}
