import { describe, expect, it } from 'vitest';
import { expectCommitToFail, withClient } from '../setup/db.js';
import {
  balanceOf,
  createAccount,
  integrityViolations,
  transfer,
  writeTransaction,
} from '../setup/fixtures.js';

describe('double-entry invariants', () => {
  describe('rule 1: a transaction needs at least two entries', () => {
    it('rejects a transaction with a single entry', async () => {
      const account = await createAccount();

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          entries: [{ accountId: account, direction: 'CREDIT', amount: 5_000n }],
        });
      });

      expect(error.message).toContain('minimum is 2');
      expect(error.code).toBe('23514');
    });

    it('rejects a transaction with no entries at all', async () => {
      const error = await expectCommitToFail(async (client) => {
        await client.query(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 5000, 'UZS', now())`,
        );
      });

      expect(error.message).toContain('0 ledger entries');
    });
  });

  describe('rule 2: debits equal credits', () => {
    it('rejects entries that do not sum to zero', async () => {
      const from = await createAccount();
      const to = await createAccount();

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          entries: [
            { accountId: from, direction: 'DEBIT', amount: 5_000n },
            { accountId: to, direction: 'CREDIT', amount: 4_999n },
          ],
        });
      });

      expect(error.message).toMatch(/unbalanced.*debits=5000.*credits=4999/);
    });

    it('rejects two entries in the same direction', async () => {
      const first = await createAccount();
      const second = await createAccount();

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          entries: [
            { accountId: first, direction: 'CREDIT', amount: 5_000n },
            { accountId: second, direction: 'CREDIT', amount: 5_000n },
          ],
        });
      });

      expect(error.message).toContain('unbalanced');
    });

    it('accepts a balanced transfer split across three entries', async () => {
      const source = await createAccount();
      const recipient = await createAccount();
      const feeAccount = await createAccount();

      await withClient(async (client) => {
        await client.query('BEGIN');
        await writeTransaction(client, {
          amount: 10_000n,
          entries: [
            { accountId: source, direction: 'DEBIT', amount: 10_000n },
            { accountId: recipient, direction: 'CREDIT', amount: 9_500n },
            { accountId: feeAccount, direction: 'CREDIT', amount: 500n },
          ],
        });
        await client.query('COMMIT');
      });

      expect(await balanceOf(source)).toBe(-10_000n);
      expect(await balanceOf(recipient)).toBe(9_500n);
      expect(await balanceOf(feeAccount)).toBe(500n);
      expect(await integrityViolations()).toHaveLength(0);
    });
  });

  describe('rule 3: entries match the stated amount', () => {
    it('rejects a transaction whose entries move a different amount', async () => {
      const from = await createAccount();
      const to = await createAccount();

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          entries: transfer(from, to, 7_000n),
        });
      });

      expect(error.message).toMatch(/states amount 5000 but its entries move 7000/);
    });
  });

  describe('rule 4: all accounts share the transaction currency', () => {
    it('rejects a transfer between accounts in different currencies', async () => {
      const uzsAccount = await createAccount('UZS');
      const krwAccount = await createAccount('KRW');

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          currency: 'UZS',
          entries: transfer(uzsAccount, krwAccount, 5_000n),
        });
      });

      expect(error.message).toContain('different currency');
    });

    it('rejects a transaction whose currency matches neither account', async () => {
      const from = await createAccount('UZS');
      const to = await createAccount('UZS');

      const error = await expectCommitToFail(async (client) => {
        await writeTransaction(client, {
          amount: 5_000n,
          currency: 'KRW',
          entries: transfer(from, to, 5_000n),
        });
      });

      expect(error.message).toContain('different currency');
    });
  });

  describe('validation timing', () => {
    it('does not fail on the first entry, only at commit', async () => {
      const from = await createAccount();
      const to = await createAccount();

      await withClient(async (client) => {
        await client.query('BEGIN');

        const result = await client.query<{ id: string }>(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 5000, 'UZS', now()) RETURNING id`,
        );
        const transactionId = result.rows[0]!.id;

        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
           VALUES ($1, $2, 'DEBIT', 5000)`,
          [transactionId, from],
        );

        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
           VALUES ($1, $2, 'CREDIT', 5000)`,
          [transactionId, to],
        );

        await client.query('COMMIT');
      });

      expect(await balanceOf(from)).toBe(-5_000n);
    });

    it('can be forced to validate early with SET CONSTRAINTS ALL IMMEDIATE', async () => {
      await expect(
        withClient(async (client) => {
          await client.query('BEGIN');
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');

          await client.query(
            `INSERT INTO transactions (type, status, amount, currency, completed_at)
             VALUES ('TRANSFER', 'COMPLETED', 5000, 'UZS', now())`,
          );
        }),
      ).rejects.toThrow(/0 ledger entries/);
    });
  });
});
