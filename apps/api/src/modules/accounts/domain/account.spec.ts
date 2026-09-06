import { describe, expect, it } from 'vitest';
import { AccountNotActiveError } from '../../../shared/errors/ledger.errors';
import { Account, type AccountProps } from './account';

function account(overrides: Partial<AccountProps> = {}): Account {
  return Account.fromPersistence({
    id: 'acc-1',
    userId: 'user-1',
    currency: 'UZS',
    type: 'USER',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('Account', () => {
  it('allows transactions when active', () => {
    expect(account().canTransact).toBe(true);
    expect(() => account().assertCanTransact()).not.toThrow();
  });

  it('blocks a frozen account in both directions', () => {
    const frozen = account({ status: 'FROZEN' });

    expect(frozen.canTransact).toBe(false);
    expect(() => frozen.assertCanTransact()).toThrow(AccountNotActiveError);
  });

  it('blocks a closed account', () => {
    expect(account({ status: 'CLOSED' }).canTransact).toBe(false);
  });

  it('reports the status in the error', () => {
    try {
      account({ status: 'FROZEN' }).assertCanTransact();
      expect.unreachable();
    } catch (error) {
      expect((error as AccountNotActiveError).details['status']).toBe('FROZEN');
    }
  });

  it('identifies system accounts', () => {
    expect(account({ type: 'SYSTEM', userId: null }).isSystem).toBe(true);
    expect(account().isSystem).toBe(false);
  });

  it('answers which currency it holds', () => {
    expect(account({ currency: 'KRW' }).holds('KRW')).toBe(true);
    expect(account({ currency: 'KRW' }).holds('UZS')).toBe(false);
  });

  it('exposes no balance', () => {
    expect('balance' in account().toJSON()).toBe(false);
  });
});
