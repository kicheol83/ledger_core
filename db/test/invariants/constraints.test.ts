import { describe, expect, it } from 'vitest';
import { query, withClient } from '../setup/db';
import {
  createAccount,
  createSystemAccount,
  createUser,
  transfer,
  writeTransaction,
} from '../setup/fixtures';

describe('schema constraints', () => {
  describe('users', () => {
    it('rejects a non-lowercase email', async () => {
      await expect(query(`INSERT INTO users (email) VALUES ('Mixed@Case.test')`)).rejects.toThrow(
        /users_email_lowercase/,
      );
    });

    it('rejects a malformed email', async () => {
      await expect(query(`INSERT INTO users (email) VALUES ('not-an-email')`)).rejects.toThrow(
        /users_email_format/,
      );
    });

    it('rejects a duplicate email', async () => {
      await query(`INSERT INTO users (email) VALUES ('dup@example.test')`);

      await expect(query(`INSERT INTO users (email) VALUES ('dup@example.test')`)).rejects.toThrow(
        /users_email_key/,
      );
    });
  });

  describe('accounts', () => {
    it('rejects a USER account without an owner', async () => {
      await expect(
        query(`INSERT INTO accounts (type, currency) VALUES ('USER', 'UZS')`),
      ).rejects.toThrow(/accounts_ownership_matches_type/);
    });

    it('rejects a SYSTEM account with an owner', async () => {
      const userId = await createUser();

      await expect(
        query(`INSERT INTO accounts (type, currency, user_id) VALUES ('SYSTEM', 'UZS', $1)`, [
          userId,
        ]),
      ).rejects.toThrow(/accounts_ownership_matches_type/);
    });

    it('rejects a second SYSTEM account in the same currency', async () => {
      await createSystemAccount('UZS');

      await expect(
        query(`INSERT INTO accounts (type, currency) VALUES ('SYSTEM', 'UZS')`),
      ).rejects.toThrow(/accounts_one_system_per_currency/);
    });

    it('allows SYSTEM accounts in different currencies', async () => {
      await createSystemAccount('UZS');
      await expect(createSystemAccount('KRW')).resolves.toBeTruthy();
    });

    it('rejects a lowercase currency code', async () => {
      const userId = await createUser();

      await expect(
        query(`INSERT INTO accounts (user_id, currency) VALUES ($1, 'uzs')`, [userId]),
      ).rejects.toThrow(/accounts_currency_format/);
    });
  });

  describe('transactions', () => {
    it('rejects a zero amount', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 0, 'UZS', now())`,
        ),
      ).rejects.toThrow(/transactions_amount_positive/);
    });

    it('rejects a negative amount', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', -100, 'UZS', now())`,
        ),
      ).rejects.toThrow(/transactions_amount_positive/);
    });

    it('rejects COMPLETED with a null completed_at', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency)
           VALUES ('TRANSFER', 'COMPLETED', 100, 'UZS')`,
        ),
      ).rejects.toThrow(/transactions_completed_at_matches_status/);
    });

    it('rejects PENDING with a completed_at', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('TRANSFER', 'PENDING', 100, 'UZS', now())`,
        ),
      ).rejects.toThrow(/transactions_completed_at_matches_status/);
    });

    it('rejects a non-REVERSAL type carrying a reversal link', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, reverses_id, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 100, 'UZS', gen_random_uuid(), now())`,
        ),
      ).rejects.toThrow(/transactions_reversal_link_matches_type/);
    });

    it('rejects a REVERSAL without a reversal link', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, completed_at)
           VALUES ('REVERSAL', 'COMPLETED', 100, 'UZS', now())`,
        ),
      ).rejects.toThrow(/transactions_reversal_link_matches_type/);
    });

    it('rejects non-object metadata', async () => {
      await expect(
        query(
          `INSERT INTO transactions (type, status, amount, currency, metadata, completed_at)
           VALUES ('TRANSFER', 'COMPLETED', 100, 'UZS', '"a string"'::jsonb, now())`,
        ),
      ).rejects.toThrow(/transactions_metadata_is_object/);
    });
  });

  describe('ledger entries', () => {
    it('rejects a zero amount', async () => {
      const account = await createAccount();

      await expect(
        withClient(async (client) => {
          await client.query('BEGIN');
          const result = await client.query<{ id: string }>(
            `INSERT INTO transactions (type, status, amount, currency, completed_at)
             VALUES ('TRANSFER', 'COMPLETED', 100, 'UZS', now()) RETURNING id`,
          );
          await client.query(
            `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
             VALUES ($1, $2, 'DEBIT', 0)`,
            [result.rows[0]!.id, account],
          );
          await client.query('COMMIT');
        }),
      ).rejects.toThrow(/ledger_entries_amount_positive/);
    });

    it('rejects an entry referencing a nonexistent account', async () => {
      await expect(
        withClient(async (client) => {
          await client.query('BEGIN');
          const result = await client.query<{ id: string }>(
            `INSERT INTO transactions (type, status, amount, currency, completed_at)
             VALUES ('TRANSFER', 'COMPLETED', 100, 'UZS', now()) RETURNING id`,
          );
          await client.query(
            `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount)
             VALUES ($1, gen_random_uuid(), 'DEBIT', 100)`,
            [result.rows[0]!.id],
          );
          await client.query('COMMIT');
        }),
      ).rejects.toThrow(/ledger_entries_account_id_fkey/);
    });
  });
});

describe('reversal rules', () => {
  async function completedTransfer(amount = 5_000n): Promise<string> {
    const from = await createAccount();
    const to = await createAccount();

    return withClient(async (client) => {
      await client.query('BEGIN');
      const id = await writeTransaction(client, { amount, entries: transfer(from, to, amount) });
      await client.query('COMMIT');
      return id;
    });
  }

  it('accepts a reversal that matches the original exactly', async () => {
    const from = await createAccount();
    const to = await createAccount();

    const originalId = await withClient(async (client) => {
      await client.query('BEGIN');
      const id = await writeTransaction(client, {
        amount: 5_000n,
        entries: transfer(from, to, 5_000n),
      });
      await client.query('COMMIT');
      return id;
    });

    await withClient(async (client) => {
      await client.query('BEGIN');
      await writeTransaction(client, {
        type: 'REVERSAL',
        amount: 5_000n,
        reversesId: originalId,

        entries: transfer(to, from, 5_000n),
      });
      await client.query('COMMIT');
    });

    const result = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transactions WHERE reverses_id = $1`,
      [originalId],
    );
    expect(result.rows[0]!.count).toBe('1');
  });

  it('rejects a reversal with a different amount', async () => {
    const originalId = await completedTransfer(5_000n);
    const from = await createAccount();
    const to = await createAccount();

    await expect(
      withClient(async (client) => {
        await client.query('BEGIN');
        await writeTransaction(client, {
          type: 'REVERSAL',
          amount: 2_000n,
          reversesId: originalId,
          entries: transfer(from, to, 2_000n),
        });
        await client.query('COMMIT');
      }),
    ).rejects.toThrow(/must match the original exactly/);
  });

  it('rejects reversing a PENDING transaction', async () => {
    const from = await createAccount();
    const to = await createAccount();

    const pendingId = await withClient(async (client) => {
      await client.query('BEGIN');
      const id = await writeTransaction(client, {
        amount: 5_000n,
        status: 'PENDING',
        entries: transfer(from, to, 5_000n),
      });
      await client.query('COMMIT');
      return id;
    });

    await expect(
      withClient(async (client) => {
        await client.query('BEGIN');
        await writeTransaction(client, {
          type: 'REVERSAL',
          amount: 5_000n,
          reversesId: pendingId,
          entries: transfer(to, from, 5_000n),
        });
        await client.query('COMMIT');
      }),
    ).rejects.toThrow(/cannot reverse transaction .* with status PENDING/);
  });

  it('rejects reversing a transaction twice', async () => {
    const originalId = await completedTransfer();
    const from = await createAccount();
    const to = await createAccount();

    await withClient(async (client) => {
      await client.query('BEGIN');
      await writeTransaction(client, {
        type: 'REVERSAL',
        amount: 5_000n,
        reversesId: originalId,
        entries: transfer(from, to, 5_000n),
      });
      await client.query('COMMIT');
    });

    await expect(
      withClient(async (client) => {
        await client.query('BEGIN');
        await writeTransaction(client, {
          type: 'REVERSAL',
          amount: 5_000n,
          reversesId: originalId,
          entries: transfer(from, to, 5_000n),
        });
        await client.query('COMMIT');
      }),
    ).rejects.toThrow(/transactions_one_reversal_per_original/);
  });

  it('rejects reversing a reversal', async () => {
    const originalId = await completedTransfer();
    const from = await createAccount();
    const to = await createAccount();

    const reversalId = await withClient(async (client) => {
      await client.query('BEGIN');
      const id = await writeTransaction(client, {
        type: 'REVERSAL',
        amount: 5_000n,
        reversesId: originalId,
        entries: transfer(from, to, 5_000n),
      });
      await client.query('COMMIT');
      return id;
    });

    await query(`UPDATE transactions SET status = 'REVERSED' WHERE id = $1`, [originalId]);

    await expect(
      withClient(async (client) => {
        await client.query('BEGIN');
        await writeTransaction(client, {
          type: 'REVERSAL',
          amount: 5_000n,
          reversesId: reversalId,
          entries: transfer(to, from, 5_000n),
        });
        await client.query('COMMIT');
      }),
    ).rejects.toThrow(/cannot reverse a reversal/);
  });
});
