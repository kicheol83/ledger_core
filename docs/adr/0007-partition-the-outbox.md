# ADR-0007: Partition the outbox, not the ledger

- **Status:** Accepted
- **Date:** 2026-09-02

## Context

The original plan for this project was to partition `transactions` by month.
That was written before the schema existed, and building it made clear it was
the wrong table. This record explains why, and what was done instead.

Three tables grow without bound: `ledger_entries` (two or more rows per
transaction, never deleted), `transactions` (one row per operation, never
deleted), and `outbox_events` (one row per operation, deleted after
delivery).

## Why not `transactions`

A partitioned table's primary key must include the partition key, so the key
becomes `(id, created_at)`. Three tables have foreign keys pointing at
`transactions.id`: `ledger_entries`, `idempotency_keys`, and `transactions`
itself through `reverses_id`. A foreign key must reference a unique
constraint, so each of them would have to carry `created_at` as well —
including `reverses_id`, which would need the _original's_ timestamp
denormalised into every reversal.

The partial unique index that prevents double reversal also stops being
global: unique indexes on a partitioned table are per-partition unless they
include the partition key. Two reversals of the same transaction landing in
different months would both succeed. That is a double refund, and it is
exactly the failure ADR-0005 exists to prevent.

The benefit would have been dropping old partitions for retention — but this
table is never purged. Financial records are kept.

## Why not `ledger_entries`

More tempting: it is the largest table and it is append-only.

Range partitioning by time actively harms the workload. A balance is derived
from an account's entire history (ADR-0002), so `WHERE account_id = $1` has
no predicate on the partition key and every partition must be scanned. The
covering index that makes balance derivation an index-only scan becomes N
index-only scans plus an append. Partitioning would make the hottest query in
the system slower, in exchange for retention behaviour on a table that is
never purged.

Hash partitioning on `account_id` would preserve the balance query — one
partition per lookup — and is the shape to reach for if this table ever needs
splitting. It gives no retention benefit, so it is worth doing only when a
single table's size becomes the problem. It is not, at any volume this system
has been measured at.

## Why `outbox_events`

Every argument that fails for the other two holds here.

It is purged: published events are deleted after a retention window. With a
plain table that is a bulk `DELETE`, which writes WAL for every row, leaves
dead tuples for autovacuum, and bloats the table and its indexes. With
monthly partitions it is `DROP TABLE` on a whole month — near-instant,
minimal WAL, no bloat.

Its queries carry the partition key implicitly. The worker reads
`status = 'PENDING' AND next_attempt_at <= now()`, which is always recent
data; older partitions are pruned. Dead-letter investigation is by date.
Nothing needs a global scan.

Nothing references it. No foreign key points at `outbox_events`, so widening
its primary key to `(id, created_at)` costs nothing.

And it churns hardest: one row per money movement, all of them eventually
deleted, which is precisely the pattern that punishes a plain table.

## Decision

Partition `outbox_events` by `RANGE (created_at)`, monthly.

A `DEFAULT` partition catches rows outside any defined range, so a missed
maintenance run degrades to slower queries rather than failed inserts —
losing an event because no partition exists would be losing a notification
about money.

Partition creation and dropping are SQL functions called by a scheduled job,
not by the application. `pg_cron` is not assumed, since managed Postgres
services do not all provide it.

`transactions` and `ledger_entries` stay unpartitioned. The conditions that
would change that are recorded below rather than left implicit.

## Consequences

Retention on the outbox becomes a metadata operation instead of a bulk
delete, and the table stops accumulating bloat from its own churn.

Maintenance is now a real responsibility: partitions must be created ahead of
time. The `DEFAULT` partition means forgetting is survivable, but a system
that runs for months on the default partition has quietly given up every
benefit of partitioning, so the monitoring for it matters.

Queries that ignore `created_at` scan every partition. The worker's poll does
not, but a future ad-hoc query might, and it will be slower than it was.

`transactions` and `ledger_entries` keep growing linearly. At the volumes
measured in load testing this is not a problem, and the indexes are what keep
the important queries fast rather than the table size.

## Revisit if

`ledger_entries` grows past roughly a hundred million rows and index
maintenance becomes the bottleneck — the answer then is hash partitioning on
`account_id`, not range partitioning on time.

Or if a regulatory retention limit is introduced for `transactions`, which
would make time-range partitioning worth its cost there despite the foreign
key complications.
