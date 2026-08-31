-- Up Migration

CREATE TABLE outbox_events (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    aggregate_type TEXT NOT NULL,
    aggregate_id   UUID NOT NULL,

    event_type     TEXT NOT NULL,
    payload        JSONB NOT NULL,

    status         TEXT NOT NULL DEFAULT 'PENDING',
    attempts       INT NOT NULL DEFAULT 0,
    last_error     TEXT,

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,

    CONSTRAINT outbox_events_status_valid
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),

    CONSTRAINT outbox_events_attempts_non_negative CHECK (attempts >= 0),

    CONSTRAINT outbox_events_published_at_matches_status
        CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),

    CONSTRAINT outbox_events_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX outbox_events_due_idx
    ON outbox_events (next_attempt_at, id)
    WHERE status = 'PENDING';

CREATE INDEX outbox_events_aggregate_idx
    ON outbox_events (aggregate_type, aggregate_id, id);

CREATE INDEX outbox_events_failed_idx
    ON outbox_events (created_at)
    WHERE status = 'FAILED';

COMMENT ON TABLE outbox_events IS
    'Transactional outbox. Rows are written with the ledger entries they describe and drained by a separate worker.';

COMMENT ON COLUMN outbox_events.next_attempt_at IS
    'Backoff is expressed here rather than by sleeping, so a failing event does not block the queue.';

CREATE OR REPLACE FUNCTION purge_published_outbox_events(
    p_older_than INTERVAL DEFAULT interval '7 days',
    p_limit INT DEFAULT 10000
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INT;
BEGIN
    WITH old AS (
        SELECT id FROM outbox_events
         WHERE status = 'PUBLISHED'
           AND published_at < now() - p_older_than
         ORDER BY id
         LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    )
    DELETE FROM outbox_events e
     USING old
     WHERE e.id = old.id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- Down Migration

DROP FUNCTION IF EXISTS purge_published_outbox_events(INTERVAL, INT);
DROP TABLE IF EXISTS outbox_events;
