# ADR-0005: Ledger rules in the database

Date: 2026-08-19

## Context

A valid transaction has at least two entries, debits equal credits, the entries move exactly the transaction amount, and every account uses the transaction's currency. These are rules about a set of rows, so a `CHECK` constraint cannot express them.

## Decision

Check all four rules in `DEFERRABLE INITIALLY DEFERRED` constraint triggers. They run at `COMMIT`, after all entries of the transaction are written.

`ledger_entries` is append-only. `UPDATE` and `DELETE` are blocked by a trigger.

## Consequences

Some business logic is in plpgsql, which is harder to test and not visible from TypeScript. The `db/test` suite covers these rules directly.
