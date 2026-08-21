import { describe, expect, it } from 'vitest';
import { query, withClient } from '../setup/db.js';
import { balanceOf, createAccount, transfer, writeTransaction } from '../setup/fixtures.js';

async function committedTransfer(amount = 5_000n): Promise<{
  transactionId: string;
  from: string;
  to: string;
}> {
  const from = await createAccount();
  const to = await createAccount();

  const transactionId = await withClient(async (client) => {
    await client.query('BEGIN');
    const id = await writeTransaction(client, { amount, entries: transfer(from, to, amount) });
    await client.query('COMMIT');
    return id;
  });

  return { transactionId, from, to };
}

describe('immutability', () => {
  describe('ledger entries', () => {
    it('rejects UPDATE', async () => {
      await committedTransfer();

      await expect(query('UPDATE ledger_entries SET amount = 1')).rejects.toThrow(
        /append-only; UPDATE is not permitted/,
      );
    });

    it('rejects DELETE', async () => {
      await committedTransfer();

      await expect(query('DELETE FROM ledger_entries')).rejects.toThrow(
        /append-only; DELETE is not permitted/,
      );
    });

    it('rejects TRUNCATE', async () => {
      await committedTransfer();

      await expect(query('TRUNCATE ledger_entries CASCADE')).rejects.toThrow(
        /append-only; TRUNCATE is not permitted/,
      );
    });

    it('leaves balances intact after a rejected mutation', async () => {
      const { from } = await committedTransfer(5_000n);

      await expect(query('UPDATE ledger_entries SET amount = 999999')).rejects.toThrow();

      expect(await balanceOf(from)).toBe(-5_000n);
    });
  });

  describe('transactions', () => {
    it('rejects changing the amount', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query('UPDATE transactions SET amount = 999 WHERE id = $1', [transactionId]),
      ).rejects.toThrow(/amount is immutable/);
    });

    it('rejects changing the currency', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query(`UPDATE transactions SET currency = 'KRW' WHERE id = $1`, [transactionId]),
      ).rejects.toThrow(/currency is immutable/);
    });

    it('rejects changing the type', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query(`UPDATE transactions SET type = 'DEPOSIT' WHERE id = $1`, [transactionId]),
      ).rejects.toThrow(/type is immutable/);
    });

    it('rejects DELETE', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query('DELETE FROM transactions WHERE id = $1', [transactionId]),
      ).rejects.toThrow(/cannot be deleted/);
    });
  });

  describe('transaction status transitions', () => {
    async function pendingTransaction(): Promise<string> {
      const from = await createAccount();
      const to = await createAccount();

      return withClient(async (client) => {
        await client.query('BEGIN');
        const id = await writeTransaction(client, {
          amount: 5_000n,
          status: 'PENDING',
          entries: transfer(from, to, 5_000n),
        });
        await client.query('COMMIT');
        return id;
      });
    }

    it('allows PENDING to COMPLETED', async () => {
      const id = await pendingTransaction();

      await query(
        `UPDATE transactions SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
        [id],
      );

      const result = await query<{ status: string }>(
        'SELECT status FROM transactions WHERE id = $1',
        [id],
      );
      expect(result.rows[0]!.status).toBe('COMPLETED');
    });

    it('allows PENDING to FAILED', async () => {
      const id = await pendingTransaction();

      await query(`UPDATE transactions SET status = 'FAILED', completed_at = now() WHERE id = $1`, [
        id,
      ]);

      const result = await query<{ status: string }>(
        'SELECT status FROM transactions WHERE id = $1',
        [id],
      );
      expect(result.rows[0]!.status).toBe('FAILED');
    });

    it('allows COMPLETED to REVERSED', async () => {
      const { transactionId } = await committedTransfer();

      await query(`UPDATE transactions SET status = 'REVERSED' WHERE id = $1`, [transactionId]);

      const result = await query<{ status: string }>(
        'SELECT status FROM transactions WHERE id = $1',
        [transactionId],
      );
      expect(result.rows[0]!.status).toBe('REVERSED');
    });

    it('rejects COMPLETED back to PENDING', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query(`UPDATE transactions SET status = 'PENDING' WHERE id = $1`, [transactionId]),
      ).rejects.toThrow(/invalid status transition: COMPLETED -> PENDING/);
    });

    it('rejects REVERSED back to COMPLETED', async () => {
      const { transactionId } = await committedTransfer();
      await query(`UPDATE transactions SET status = 'REVERSED' WHERE id = $1`, [transactionId]);

      await expect(
        query(`UPDATE transactions SET status = 'COMPLETED' WHERE id = $1`, [transactionId]),
      ).rejects.toThrow(/invalid status transition: REVERSED -> COMPLETED/);
    });

    it('rejects FAILED to COMPLETED', async () => {
      const id = await pendingTransaction();
      await query(`UPDATE transactions SET status = 'FAILED', completed_at = now() WHERE id = $1`, [
        id,
      ]);

      await expect(
        query(`UPDATE transactions SET status = 'COMPLETED' WHERE id = $1`, [id]),
      ).rejects.toThrow(/invalid status transition: FAILED -> COMPLETED/);
    });

    it('rejects rewriting completed_at once set', async () => {
      const { transactionId } = await committedTransfer();

      await expect(
        query('UPDATE transactions SET completed_at = now() WHERE id = $1', [transactionId]),
      ).rejects.toThrow(/completed_at is write-once/);
    });
  });

  describe('accounts', () => {
    it('rejects changing the currency', async () => {
      const account = await createAccount('UZS');

      await expect(
        query(`UPDATE accounts SET currency = 'KRW' WHERE id = $1`, [account]),
      ).rejects.toThrow(/currency is immutable/);
    });

    it('rejects reassigning ownership', async () => {
      const account = await createAccount();

      await expect(
        query('UPDATE accounts SET user_id = gen_random_uuid() WHERE id = $1', [account]),
      ).rejects.toThrow(/ownership is immutable/);
    });

    it('allows a status change', async () => {
      const account = await createAccount();

      await query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1`, [account]);

      const result = await query<{ status: string }>('SELECT status FROM accounts WHERE id = $1', [
        account,
      ]);
      expect(result.rows[0]!.status).toBe('FROZEN');
    });
  });
});
