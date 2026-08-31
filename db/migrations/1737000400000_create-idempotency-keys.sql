-- Up Migration

CREATE TABLE idempotency_keys (
    key            TEXT PRIMARY KEY,

    endpoint       TEXT NOT NULL,

    request_hash   TEXT NOT NULL,

    response_status INT,
    response_body   JSONB,

    transaction_id UUID REFERENCES transactions (id) ON DELETE RESTRICT,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,

    CONSTRAINT idempotency_keys_key_length CHECK (length(key) BETWEEN 8 AND 255),
    CONSTRAINT idempotency_keys_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS
    'Deduplicates client retries. Written in the same transaction as the operation it guards.';

COMMENT ON COLUMN idempotency_keys.request_hash IS
    'SHA-256 of the canonical request body; a mismatch means the key was reused for different content.';

CREATE OR REPLACE FUNCTION purge_expired_idempotency_keys(p_limit INT DEFAULT 10000)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INT;
BEGIN
    WITH expired AS (
        SELECT key FROM idempotency_keys
         WHERE expires_at < now()
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM idempotency_keys k
     USING expired
     WHERE k.key = expired.key;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- Down Migration

DROP FUNCTION IF EXISTS purge_expired_idempotency_keys(INT);
DROP TABLE IF EXISTS idempotency_keys;
