# ADR-0005: Enforce ledger invariants in the database

- **Status:** Accepted
- **Date:** 2026-01-16

## Context

Four rules define a valid transaction:

1. It has at least two ledger entries.
2. Its debits equal its credits.
3. Its entries move exactly the amount the transaction states.
4. Every account it touches uses the transaction's currency.

None of these can be expressed as a `CHECK` constraint. A `CHECK` sees a
single row; all four are properties of the _set_ of entries belonging to a
transaction — and that set does not exist until the final `INSERT` has run.

## Options considered

### Validate in the application service

The natural place: the ledger service already builds the entries, so it can
verify them before writing.

It holds only as long as the service is the sole writer. Backfill scripts,
a future reporting job, an operator in `psql`, and any new code path all
bypass it. In a system whose entire value is that the numbers are right, the
guarantee should not depend on which code path performed the write.

### Immediate `AFTER INSERT` trigger on `ledger_entries`

Fires after each row. The first entry of a two-entry transfer is unbalanced by
construction, so every valid transaction would be rejected. Unusable.

### Deferred constraint trigger

`CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` queues the check
and runs it at `COMMIT`, once all statements have executed. The set exists by
then, so the set-level rules can be evaluated.

## Decision

Enforce all four rules in deferred constraint triggers.

Two triggers are registered, both calling one validation function:

- on `ledger_entries`, covering entries written after the transaction row;
- on `transactions`, covering a transaction row committed with no entries at
  all — which the first trigger would never see.

Reversal consistency (amount and currency match the original, the original is
`COMPLETED`, a reversal cannot itself be reversed) is checked in an
_immediate_ `BEFORE INSERT` trigger instead. Those are row-level facts,
knowable at insert time, and failing early produces a clearer error than
failing at `COMMIT` among unrelated work.

A `verify_ledger_integrity()` function performs the same checks retroactively
across the whole table, for use in tests and scheduled reconciliation.

## Consequences

The invariants hold regardless of who writes. A migration, a script, or a
future service physically cannot commit an invalid transaction.

Errors surface at `COMMIT`, not at the offending statement. This is unusual
enough to confuse someone reading a stack trace for the first time, so the
exception messages name the transaction and state both totals.

Constraint triggers must be `FOR EACH ROW`; Postgres has no deferrable
statement-level trigger. A two-entry transfer therefore runs the validation
twice. Each run is an index-only aggregate over a few rows on
`ledger_entries_transaction_idx`, which is an acceptable cost at this
transaction size. A future bulk-import path inserting thousands of entries per
transaction would want `SET CONSTRAINTS ... DEFERRED` around the load and a
single validation; that path does not exist and the optimisation is not built
speculatively.

Business logic now lives partly in `plpgsql`. This is a real cost: it is
harder to test in isolation than TypeScript, it is invisible to developers
reading only the application code, and it can only change through a migration.
The mitigation is that the rules encoded there are few, stable, and definitional
rather than policy — they are what a ledger _is_, not how this product behaves
this quarter.

## Revisit if

The validation cost becomes measurable under load testing, or a legitimate
use case requires transactions with many entries. The answer in both cases is
batching the check, not moving it into the application.
