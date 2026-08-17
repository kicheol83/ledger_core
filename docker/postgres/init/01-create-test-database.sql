

SELECT 'CREATE DATABASE ledgercore_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ledgercore_test')
\gexec

\connect ledgercore_test
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

\connect ledgercore
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
