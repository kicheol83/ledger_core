

CREATE OR REPLACE FUNCTION test_reset_ledger()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_database() NOT LIKE '%\_test' THEN
        RAISE EXCEPTION
            'test_reset_ledger() refused: database % is not a test database',
            current_database();
    END IF;

    ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_reject_mutation;
    ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_reject_truncate;
    ALTER TABLE transactions   DISABLE TRIGGER transactions_reject_truncate;
    ALTER TABLE transactions   DISABLE TRIGGER transactions_reject_delete;

    TRUNCATE ledger_entries, transactions, accounts, users RESTART IDENTITY CASCADE;

    ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_reject_mutation;
    ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_reject_truncate;
    ALTER TABLE transactions   ENABLE TRIGGER transactions_reject_truncate;
    ALTER TABLE transactions   ENABLE TRIGGER transactions_reject_delete;
END;
$$;

COMMENT ON FUNCTION test_reset_ledger() IS
    'Test fixture only. Refuses to run outside a database whose name ends in _test.';
