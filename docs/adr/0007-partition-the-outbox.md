# ADR-0007: Partition the outbox, not the ledger

Date: 2026-09-02

## Context

My first plan was to partition `transactions` by month. While building the schema I found a problem: on a partitioned table a unique index must include the partition key, so the unique constraint that blocks a second reversal of the same transaction would only work inside one month.

## Decision

Keep `transactions` and `ledger_entries` unpartitioned. Partition `outbox_events` by `RANGE (created_at)` monthly, with a `DEFAULT` partition. Old published events can be dropped by detaching a partition.

## Consequences

The ledger tables keep growing. For this project's size that is fine, and index scans stay fast.
