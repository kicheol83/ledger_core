# ADR-0002: Derive balances from entries; no balance column

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Every transfer needs the sender's current balance to decide whether it can
proceed, and clients need to display balances. The obvious design is a
`balance` column on `accounts`, updated on each transaction.

That design has a specific, well-known failure mode. `UPDATE accounts SET
balance = balance - 100` is atomic per statement, but the _decision_ to run it
was made from an earlier read. Under `READ COMMITTED`, two concurrent
transfers can both read a balance of 100, both conclude the withdrawal is
allowed, and both apply it — the account ends at -100 with no constraint
violated. A `CHECK (balance >= 0)` catches this particular case, but the same
race applies to any rule that reads before writing.

The deeper problem is that a stored balance is a second source of truth. Once
it exists, it can disagree with the entries, and there is no way to tell which
one is right.

## Options considered

### Stored balance column, updated in the same transaction

Fast reads — one indexed lookup. Requires locking the account row before the
read-modify-write to be safe, which is manageable.

The disqualifying issue is not performance, it is reconciliation. Any bug, any
manual `UPDATE`, any partially-applied migration leaves the column and the
entries out of sync, and the system has no basis for deciding the true value.
Detecting the drift requires computing the sum anyway.

### Derived balance, computed from `ledger_entries` on read

One source of truth. The entries are immutable and append-only, so the sum is
by definition correct. Drift is impossible because there is nothing to drift
from.

The cost is that reading a balance is an aggregation rather than a lookup, and
it grows linearly with the account's entry count.

### Derived, with periodic snapshots

Same guarantee, with a `account_balance_snapshots` table recording a balance
as of a given entry id. A read sums the snapshot plus entries after it. The
snapshot is a cache that can be rebuilt from the entries at any time, so it is
never a competing source of truth.

## Decision

Balances are derived from `ledger_entries`. There is no `balance` column.

The initial implementation aggregates directly. A covering index on
`(account_id, id) INCLUDE (direction, amount)` keeps the aggregation
index-only.

Snapshots are deferred until measurement shows they are needed, and will be
introduced as a rebuildable cache — never as an authoritative value.

## Consequences

The ledger has exactly one source of truth. A balance cannot be wrong unless
the entries are wrong, and the entries are immutable.

Auditing becomes trivial: the balance at any past point is the same query with
a timestamp predicate. With a stored column that history does not exist.

Reads are more expensive than a column lookup, and get more expensive as an
account accumulates entries. This is the accepted cost, bounded by the
covering index and, later, by snapshots.

Balance checks still require locking. Deriving the balance removes the
lost-update problem but not the read-then-decide problem: between computing
the sender's balance and inserting entries, a concurrent transfer could insert
its own. The transfer path therefore locks the account rows before reading.
That is a separate decision, recorded when the transfer is implemented.

## Revisit if

Balance reads become a measured bottleneck under load testing. The response is
snapshots, not a balance column.
