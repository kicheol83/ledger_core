-- Up Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_stat_statements is unavailable (%), continuing without it', SQLERRM;
END;
$$;

-- Down Migration

DROP EXTENSION IF EXISTS pg_stat_statements;
