-- Up Migration

CREATE OR REPLACE FUNCTION assert_transaction_balanced(p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_entry_count        INT;
    v_imbalance          BIGINT;
    v_debit_total        BIGINT;
    v_credit_total       BIGINT;
    v_stated_amount      BIGINT;
    v_stated_currency    CHAR(3);
    v_mismatched_account UUID;
BEGIN
    SELECT amount, currency
      INTO v_stated_amount, v_stated_currency
      FROM transactions
     WHERE id = p_transaction_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT
        count(*),
        coalesce(sum(amount) FILTER (WHERE direction = 'DEBIT'), 0),
        coalesce(sum(amount) FILTER (WHERE direction = 'CREDIT'), 0)
      INTO v_entry_count, v_debit_total, v_credit_total
      FROM ledger_entries
     WHERE transaction_id = p_transaction_id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION
            'transaction % has % ledger entries, minimum is 2',
            p_transaction_id, v_entry_count
            USING ERRCODE = '23514',
                  HINT = 'Every movement needs a source and a destination. '
                         'Deposits and withdrawals use the SYSTEM account as counterparty.';
    END IF;

    v_imbalance := v_credit_total - v_debit_total;

    IF v_imbalance <> 0 THEN
        RAISE EXCEPTION
            'transaction % is unbalanced: debits=%, credits=%, difference=%',
            p_transaction_id, v_debit_total, v_credit_total, v_imbalance
            USING ERRCODE = '23514';
    END IF;

    IF v_debit_total <> v_stated_amount THEN
        RAISE EXCEPTION
            'transaction % states amount % but its entries move %',
            p_transaction_id, v_stated_amount, v_debit_total
            USING ERRCODE = '23514';
    END IF;

    SELECT a.id
      INTO v_mismatched_account
      FROM ledger_entries e
      JOIN accounts a ON a.id = e.account_id
     WHERE e.transaction_id = p_transaction_id
       AND a.currency <> v_stated_currency
     LIMIT 1;

    IF v_mismatched_account IS NOT NULL THEN
        RAISE EXCEPTION
            'transaction % is in % but account % is in a different currency',
            p_transaction_id, v_stated_currency, v_mismatched_account
            USING ERRCODE = '23514',
                  HINT = 'Cross-currency movement requires two transactions '
                         'and an explicit conversion, not one mixed transaction.';
    END IF;
END;
$$;

COMMENT ON FUNCTION assert_transaction_balanced(UUID) IS
    'Validates the four set-level invariants of a transaction. Called at COMMIT by deferred constraint triggers.';

CREATE OR REPLACE FUNCTION trg_validate_entry_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM assert_transaction_balanced(NEW.transaction_id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_validate_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM assert_transaction_balanced(NEW.id);
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_validate_transaction
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION trg_validate_entry_transaction();

CREATE CONSTRAINT TRIGGER transactions_validate_entries
    AFTER INSERT ON transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION trg_validate_transaction();

CREATE OR REPLACE FUNCTION trg_validate_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_original RECORD;
BEGIN
    IF NEW.reverses_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.type <> 'REVERSAL' THEN
        RETURN NEW;
    END IF;

    SELECT id, type, status, amount, currency
      INTO v_original
      FROM transactions
     WHERE id = NEW.reverses_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cannot reverse transaction %: it does not exist', NEW.reverses_id
            USING ERRCODE = '23503';
    END IF;

    IF v_original.type = 'REVERSAL' THEN
        RAISE EXCEPTION 'cannot reverse a reversal (transaction %)', NEW.reverses_id
            USING ERRCODE = '23514',
                  HINT = 'To undo a reversal, issue a new transaction in the original direction.';
    END IF;

    IF v_original.status <> 'COMPLETED' THEN
        RAISE EXCEPTION
            'cannot reverse transaction % with status %',
            NEW.reverses_id, v_original.status
            USING ERRCODE = '23514';
    END IF;

    IF NEW.amount <> v_original.amount OR NEW.currency <> v_original.currency THEN
        RAISE EXCEPTION
            'reversal must match the original exactly: original is % %, reversal is % %',
            v_original.amount, v_original.currency, NEW.amount, NEW.currency
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_validate_reversal
    BEFORE INSERT ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_validate_reversal();

CREATE OR REPLACE FUNCTION verify_ledger_integrity()
RETURNS TABLE (transaction_id UUID, violation TEXT, detail TEXT)
LANGUAGE sql
STABLE
AS $$
    WITH entry_totals AS (
        SELECT
            t.id,
            t.amount   AS stated_amount,
            t.currency AS stated_currency,
            count(e.id) AS entry_count,
            coalesce(sum(e.amount) FILTER (WHERE e.direction = 'DEBIT'), 0)  AS debits,
            coalesce(sum(e.amount) FILTER (WHERE e.direction = 'CREDIT'), 0) AS credits
        FROM transactions t
        LEFT JOIN ledger_entries e ON e.transaction_id = t.id
        GROUP BY t.id, t.amount, t.currency
    )
    SELECT id, 'too_few_entries', format('entry_count=%s', entry_count)
      FROM entry_totals WHERE entry_count < 2

    UNION ALL
    SELECT id, 'unbalanced', format('debits=%s credits=%s', debits, credits)
      FROM entry_totals WHERE debits <> credits

    UNION ALL
    SELECT id, 'amount_mismatch', format('stated=%s entries=%s', stated_amount, debits)
      FROM entry_totals WHERE entry_count >= 2 AND debits <> stated_amount

    UNION ALL
    SELECT DISTINCT t.id, 'currency_mismatch', format('account=%s', a.id)
      FROM transactions t
      JOIN ledger_entries e ON e.transaction_id = t.id
      JOIN accounts a       ON a.id = e.account_id
     WHERE a.currency <> t.currency;
$$;

COMMENT ON FUNCTION verify_ledger_integrity() IS
    'Retroactive audit of every transaction. Returns one row per violation; an empty result means the ledger is consistent.';

-- Down Migration

DROP FUNCTION IF EXISTS verify_ledger_integrity();

DROP TRIGGER IF EXISTS transactions_validate_reversal ON transactions;
DROP FUNCTION IF EXISTS trg_validate_reversal();

DROP TRIGGER IF EXISTS transactions_validate_entries ON transactions;
DROP TRIGGER IF EXISTS ledger_entries_validate_transaction ON ledger_entries;
DROP FUNCTION IF EXISTS trg_validate_transaction();
DROP FUNCTION IF EXISTS trg_validate_entry_transaction();
DROP FUNCTION IF EXISTS assert_transaction_balanced(UUID);
