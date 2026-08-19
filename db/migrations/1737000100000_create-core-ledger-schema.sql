-- Up Migration

CREATE TYPE entry_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_email_format    CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_status_valid    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE UNIQUE INDEX users_email_key ON users (email);

COMMENT ON TABLE users IS
    'Account owners. Deliberately minimal — identity and profile are out of scope.';

CREATE TABLE accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES users (id) ON DELETE RESTRICT,
    currency    CHAR(3)     NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'USER',
    status      TEXT        NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT accounts_type_valid      CHECK (type IN ('USER', 'SYSTEM')),
    CONSTRAINT accounts_status_valid    CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),

    CONSTRAINT accounts_ownership_matches_type CHECK (
        (type = 'USER'   AND user_id IS NOT NULL) OR
        (type = 'SYSTEM' AND user_id IS NULL)
    )
);

CREATE INDEX accounts_user_id_idx ON accounts (user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX accounts_one_system_per_currency
    ON accounts (currency) WHERE type = 'SYSTEM';

COMMENT ON COLUMN accounts.type IS
    'USER: customer-owned. SYSTEM: internal counterparty for deposits and withdrawals.';

CREATE TABLE transactions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'PENDING',

    amount       BIGINT      NOT NULL,
    currency     CHAR(3)     NOT NULL,

    reverses_id  UUID        REFERENCES transactions (id) ON DELETE RESTRICT,

    metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT transactions_type_valid CHECK (
        type IN ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'REVERSAL')
    ),
    CONSTRAINT transactions_status_valid CHECK (
        status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')
    ),
    CONSTRAINT transactions_amount_positive CHECK (amount > 0),
    CONSTRAINT transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),

    CONSTRAINT transactions_reversal_link_matches_type CHECK (
        (type = 'REVERSAL') = (reverses_id IS NOT NULL)
    ),

    CONSTRAINT transactions_no_self_reversal CHECK (reverses_id IS DISTINCT FROM id),

    CONSTRAINT transactions_completed_at_matches_status CHECK (
        (status = 'PENDING') = (completed_at IS NULL)
    ),

    CONSTRAINT transactions_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX transactions_one_reversal_per_original
    ON transactions (reverses_id) WHERE reverses_id IS NOT NULL;

CREATE INDEX transactions_created_at_idx ON transactions (created_at DESC);
CREATE INDEX transactions_status_created_idx
    ON transactions (status, created_at DESC) WHERE status <> 'COMPLETED';

COMMENT ON COLUMN transactions.amount IS
    'Denormalised intent, in minor units. Ledger entries remain authoritative.';

CREATE TABLE ledger_entries (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id UUID            NOT NULL REFERENCES transactions (id) ON DELETE RESTRICT,
    account_id     UUID            NOT NULL REFERENCES accounts (id)     ON DELETE RESTRICT,
    direction      entry_direction NOT NULL,
    amount         BIGINT          NOT NULL,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT ledger_entries_amount_positive CHECK (amount > 0)
);

CREATE INDEX ledger_entries_balance_idx
    ON ledger_entries (account_id, id) INCLUDE (direction, amount);

CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);

COMMENT ON TABLE ledger_entries IS
    'Immutable double-entry log. Never updated or deleted; corrections are REVERSAL transactions.';

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS entry_direction;
