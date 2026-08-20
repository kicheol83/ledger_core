-- Up Migration

CREATE OR REPLACE FUNCTION trg_reject_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'ledger_entries is append-only; % is not permitted', TG_OP
        USING ERRCODE = '23514',
              HINT = 'Correct a mistake by inserting a REVERSAL transaction. '
                     'The original entries stay, and both are visible in the audit trail.';
END;
$$;

CREATE TRIGGER ledger_entries_reject_mutation
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION trg_reject_ledger_mutation();

CREATE TRIGGER ledger_entries_reject_truncate
    BEFORE TRUNCATE ON ledger_entries
    FOR EACH STATEMENT
    EXECUTE FUNCTION trg_reject_ledger_mutation();

CREATE TRIGGER transactions_reject_truncate
    BEFORE TRUNCATE ON transactions
    FOR EACH STATEMENT
    EXECUTE FUNCTION trg_reject_ledger_mutation();

CREATE OR REPLACE FUNCTION trg_protect_transaction_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'transaction id is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION
            'transaction amount is immutable (% -> %)', OLD.amount, NEW.amount
            USING ERRCODE = '23514',
                  HINT = 'The entries would no longer match the stated amount, '
                         'and no INSERT trigger fires on UPDATE to catch it.';
    END IF;

    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION 'transaction currency is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'transaction type is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.reverses_id IS DISTINCT FROM OLD.reverses_id THEN
        RAISE EXCEPTION 'reversal link is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'created_at is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'PENDING'   AND NEW.status IN ('COMPLETED', 'FAILED')) OR
            (OLD.status = 'COMPLETED' AND NEW.status = 'REVERSED')
        ) THEN
            RAISE EXCEPTION
                'invalid status transition: % -> %', OLD.status, NEW.status
                USING ERRCODE = '23514',
                      HINT = 'Permitted: PENDING->COMPLETED, PENDING->FAILED, '
                             'COMPLETED->REVERSED. FAILED and REVERSED are terminal.';
        END IF;
    END IF;

    IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
        RAISE EXCEPTION 'completed_at is write-once' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_protect_columns
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_protect_transaction_columns();

CREATE OR REPLACE FUNCTION trg_reject_transaction_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'transactions cannot be deleted'
        USING ERRCODE = '23514',
              HINT = 'Use a REVERSAL transaction. Deleting history is never the answer.';
END;
$$;

CREATE TRIGGER transactions_reject_delete
    BEFORE DELETE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION trg_reject_transaction_delete();

CREATE OR REPLACE FUNCTION trg_protect_account_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'account id is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION
            'account currency is immutable'
            USING ERRCODE = '23514',
                  HINT = 'Every past entry on this account would be reinterpreted '
                         'in a currency it never held. Open a new account instead.';
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'account type is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION
            'account ownership is immutable'
            USING ERRCODE = '23514',
                  HINT = 'Reassigning an account moves its balance between users '
                         'with no ledger entry recording it.';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_protect_columns
    BEFORE UPDATE ON accounts
    FOR EACH ROW
    EXECUTE FUNCTION trg_protect_account_columns();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM ledger_app;
        REVOKE DELETE, TRUNCATE          ON transactions   FROM ledger_app;
        REVOKE DELETE, TRUNCATE          ON accounts       FROM ledger_app;
        REVOKE DELETE, TRUNCATE          ON users          FROM ledger_app;

        GRANT SELECT, INSERT ON ledger_entries TO ledger_app;
        GRANT SELECT, INSERT, UPDATE ON transactions TO ledger_app;
        GRANT SELECT, INSERT, UPDATE ON accounts TO ledger_app;
        GRANT SELECT, INSERT, UPDATE ON users TO ledger_app;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
    END IF;
END;
$$;

-- Down Migration

DROP TRIGGER IF EXISTS accounts_protect_columns ON accounts;
DROP FUNCTION IF EXISTS trg_protect_account_columns();

DROP TRIGGER IF EXISTS transactions_reject_delete ON transactions;
DROP FUNCTION IF EXISTS trg_reject_transaction_delete();

DROP TRIGGER IF EXISTS transactions_protect_columns ON transactions;
DROP FUNCTION IF EXISTS trg_protect_transaction_columns();

DROP TRIGGER IF EXISTS transactions_reject_truncate ON transactions;
DROP TRIGGER IF EXISTS ledger_entries_reject_truncate ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_reject_mutation ON ledger_entries;
DROP FUNCTION IF EXISTS trg_reject_ledger_mutation();
