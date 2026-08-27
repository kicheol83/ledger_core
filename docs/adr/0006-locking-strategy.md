# ADR-0006: Ordered row locks instead of SERIALIZABLE

Date: 2026-08-27

## Context

Two transfers from the same account can both read the same balance, both decide it is enough, and both write. The account goes negative.

## Decision

Use `READ COMMITTED` and `SELECT ... FOR UPDATE` on every account in the transaction, always in ascending account id order. A->B and B->A then lock in the same order, so they cannot deadlock.

`SERIALIZABLE` would also be correct, but under contention it aborts and retries work that was already done. Optimistic locking has the same problem on a hot account.

## Consequences

Transfers from the same hot account wait in a queue. The `hot-account` load test shows this, with no deadlocks.
