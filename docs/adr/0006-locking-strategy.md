# ADR-0006: Serialise transfers with ordered row locks, not SERIALIZABLE

- **Status:** Accepted
- **Date:** 2026-01-18

## Context

A transfer reads the sender's balance, decides whether it is sufficient, and
then writes entries. The decision and the write are separate steps, so two
concurrent transfers from the same account can both read a balance of 5,000,
both conclude that a 5,000 withdrawal is allowed, and both write. The account
ends at -5,000 having spent money it never had.

Nothing in the schema prevents this. The deferred triggers check that each
transaction balances — and both of these do. Deriving the balance instead of
storing it (ADR-0002) removes the lost-update problem but not this one: the
race is between the read and the write, not inside either.

The transfer path must therefore serialise conflicting transfers explicitly.

## Options considered

### SERIALIZABLE isolation

Postgres's Serializable Snapshot Isolation detects read-write dependency
cycles and aborts one transaction with `40001`. It would catch this case
without any explicit locking, and the application code would read as if
concurrency did not exist — which is a real attraction.

Three things argue against it here.

It is optimistic: conflicts are detected at commit, after all the work is
done. Under contention on a hot account — a merchant receiving hundreds of
payments a minute — that means repeatedly performing a transfer and throwing
it away. Pessimistic locking makes the second transfer wait a few
milliseconds instead.

Its false-positive rate is nonzero. SSI can abort transactions that would
have been safe, because it tracks dependencies conservatively through
predicate locks. Every abort has to be retried, and retries have to be safe,
so the retry machinery is needed regardless.

And it hides where the contention is. With explicit locks, the ordering is
visible in the code and reviewable; with SSI, the same code can be correct or
a serialization-failure generator depending on access patterns that are not
apparent from reading it.

### REPEATABLE READ

Gives a stable snapshot, so the balance read cannot change mid-transaction.
It does not help: the other transfer's entries are simply invisible, and both
transactions still write. It converts a lost update into a snapshot that was
already stale when it was taken.

### Explicit row locks under READ COMMITTED

`SELECT ... FOR UPDATE` on the account rows before reading balances. The
second transfer blocks until the first commits, then reads a balance that
includes the first transfer's entries and correctly finds it insufficient.

The account row itself is not modified — the lock is on the row purely as a
mutex for the entries that reference it. This is deliberate: locking
`accounts` gives one obvious lock target per account, whereas there is no row
in `ledger_entries` to lock for a balance that does not exist yet.

## Decision

`READ COMMITTED` with explicit `SELECT ... FOR UPDATE` on every account a
transaction touches, **acquired in ascending account id order**.

The ordering is the part that matters. Two transfers, A→B and B→A, running
concurrently: without a fixed order the first locks A then waits for B, the
second locks B then waits for A, and neither can proceed. Postgres detects
this after `deadlock_timeout` and aborts one with `40P01` — correct, but a
deadlock is an avoidable cost, not an acceptable one. With a global order both
transfers try to lock the lower id first, so one simply waits.

The lock is taken with a single statement:

```sql
SELECT id, currency, status
  FROM accounts
 WHERE id = ANY($1::uuid[])
 ORDER BY id
   FOR UPDATE
```

Postgres places the `LockRows` node above the sort, so rows are locked in the
order they are produced — sorted. This is asserted by a test on the query
plan rather than trusted.

`SERIALIZABLE` remains available through `TransactionManager` for operations
where it is a better fit, and the retry machinery for `40001` and `40P01`
stays regardless: a deadlock is unlikely under this scheme but not
impossible, since other code paths may lock other tables.

## Consequences

Two transfers touching disjoint accounts do not interact at all. Contention is
scoped to the accounts actually involved, which is the natural granularity.

The lock order is a global invariant that every future write path must
respect. A new feature that locks accounts in a different order — or locks an
account after locking another table — reintroduces deadlocks. This is the main
ongoing cost, and it is mitigated by having exactly one function that acquires
account locks and by the PR template requiring lock ordering to be stated.

Lock waits are bounded by `lock_timeout` (3s locally). A transfer that waits
longer fails with `55P03` rather than hanging, and is translated to a
retryable concurrency error.

Locking `accounts` rows means an administrative `UPDATE` on an account —
freezing it, for instance — contends with in-flight transfers on that account.
This is correct behaviour rather than a cost: a freeze should not interleave
with a transfer that is halfway through its balance check.

Throughput on a single hot account is bounded by how fast transfers on it can
serialise. That is inherent to the problem, not to this choice — the account's
balance genuinely cannot be decided in parallel.

## Revisit if

A single account becomes a measured throughput bottleneck. The answer would
be balance snapshots to shorten the locked section, or an accumulator pattern
that appends entries without checking a balance (viable only for accounts that
cannot go insufficient, such as the system side of a deposit).
