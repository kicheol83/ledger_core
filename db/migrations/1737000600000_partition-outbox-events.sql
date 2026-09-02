-- Up Migration

CREATE TABLE outbox_events_backup AS SELECT * FROM outbox_events;

DROP TABLE outbox_events;

CREATE TABLE outbox_events (
    id             BIGINT GENERATED ALWAYS AS IDENTITY,

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

    PRIMARY KEY (id, created_at),

    CONSTRAINT outbox_events_status_valid
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    CONSTRAINT outbox_events_attempts_non_negative CHECK (attempts >= 0),
    CONSTRAINT outbox_events_published_at_matches_status
        CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),
    CONSTRAINT outbox_events_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
) PARTITION BY RANGE (created_at);

CREATE INDEX outbox_events_due_idx
    ON outbox_events (next_attempt_at, id)
    WHERE status = 'PENDING';

CREATE INDEX outbox_events_aggregate_idx
    ON outbox_events (aggregate_type, aggregate_id, id);

CREATE INDEX outbox_events_failed_idx
    ON outbox_events (created_at)
    WHERE status = 'FAILED';

CREATE OR REPLACE FUNCTION create_outbox_partition(p_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_start DATE := date_trunc('month', p_month)::date;
    v_end   DATE := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name  TEXT := format('outbox_events_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
        RETURN v_name;
    END IF;

    EXECUTE format(
        'CREATE TABLE %I PARTITION OF outbox_events FOR VALUES FROM (%L) TO (%L)',
        v_name, v_start, v_end
    );

    RETURN v_name;
END;
$$;

COMMENT ON FUNCTION create_outbox_partition(DATE) IS
    'Idempotent: returns the partition name whether or not it had to be created.';

CREATE OR REPLACE FUNCTION ensure_outbox_partitions(p_months_ahead INT DEFAULT 3)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_offset INT;
    v_count  INT := 0;
BEGIN
    FOR v_offset IN 0..p_months_ahead LOOP
        PERFORM create_outbox_partition((current_date + make_interval(months => v_offset))::date);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION drop_old_outbox_partitions(p_keep_months INT DEFAULT 3)
RETURNS TABLE (partition_name TEXT, action TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    v_cutoff    DATE := (date_trunc('month', current_date) - make_interval(months => p_keep_months))::date;
    v_partition RECORD;
    v_failed    BIGINT;
BEGIN
    FOR v_partition IN
        SELECT c.relname AS name
          FROM pg_class c
          JOIN pg_inherits i ON i.inhrelid = c.oid
          JOIN pg_class parent ON parent.oid = i.inhparent
         WHERE parent.relname = 'outbox_events'
           AND c.relname ~ '^outbox_events_\d{4}_\d{2}$'
           AND to_date(right(c.relname, 7), 'YYYY_MM') < v_cutoff
    LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE status = %L', v_partition.name, 'FAILED')
           INTO v_failed;

        IF v_failed > 0 THEN
            partition_name := v_partition.name;
            action := format('kept: %s failed events await investigation', v_failed);
            RETURN NEXT;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TABLE %I', v_partition.name);

        partition_name := v_partition.name;
        action := 'dropped';
        RETURN NEXT;
    END LOOP;
END;
$$;

CREATE TABLE outbox_events_default PARTITION OF outbox_events DEFAULT;

SELECT ensure_outbox_partitions(3);

INSERT INTO outbox_events (
    aggregate_type, aggregate_id, event_type, payload,
    status, attempts, last_error, next_attempt_at, created_at, published_at
)
SELECT
    aggregate_type, aggregate_id, event_type, payload,
    status, attempts, last_error, next_attempt_at, created_at, published_at
FROM outbox_events_backup
ORDER BY id;

DROP TABLE outbox_events_backup;

-- Down Migration

CREATE TABLE outbox_events_backup AS SELECT * FROM outbox_events;

DROP TABLE outbox_events;

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
    ON outbox_events (next_attempt_at, id) WHERE status = 'PENDING';
CREATE INDEX outbox_events_aggregate_idx
    ON outbox_events (aggregate_type, aggregate_id, id);
CREATE INDEX outbox_events_failed_idx
    ON outbox_events (created_at) WHERE status = 'FAILED';

INSERT INTO outbox_events (
    aggregate_type, aggregate_id, event_type, payload,
    status, attempts, last_error, next_attempt_at, created_at, published_at
)
SELECT
    aggregate_type, aggregate_id, event_type, payload,
    status, attempts, last_error, next_attempt_at, created_at, published_at
FROM outbox_events_backup
ORDER BY id;

DROP TABLE outbox_events_backup;

DROP FUNCTION IF EXISTS drop_old_outbox_partitions(INT);
DROP FUNCTION IF EXISTS ensure_outbox_partitions(INT);
DROP FUNCTION IF EXISTS create_outbox_partition(DATE);
