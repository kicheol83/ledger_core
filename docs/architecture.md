# Architecture

## What this system is

LedgerCore records movements of money between accounts. Its only real
requirement is that it is never wrong: no money is created, none disappears,
and no transfer is applied twice — including when requests arrive
concurrently, when the client retries, and when a process dies mid-flight.

Everything below follows from that requirement.

## Core model: double-entry

Money is never stored as a number that gets updated. It is stored as an
immutable log of movements.

A transaction is a business event ("A sends 10,000 to B"). It produces two or
more ledger entries, each either a `DEBIT` or a `CREDIT` against one account.
The entries of a transaction must sum to zero.

```
transaction: TRANSFER 10,000 UZS
  ├─ entry: DEBIT  account_A  10,000
  └─ entry: CREDIT account_B  10,000
                              ───────
                    net effect:     0
```

A balance is therefore not stored — it is derived:

```sql
SELECT SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)
FROM ledger_entries
WHERE account_id = $1;
```

Two consequences worth stating explicitly:

Deposits and withdrawals also need two sides. Money entering the system comes
from a `SYSTEM` account, not from nowhere. This keeps the zero-sum invariant
true for every transaction type without special cases.

Corrections never mutate history. A mistaken transfer is fixed by writing a
`REVERSAL` transaction with the opposite entries. The original stays. This is
how real ledgers work, and it is what makes an audit trail meaningful.

See [ADR-0002](adr/0002-no-balance-column.md).

## Where the invariants live

The invariants are enforced by PostgreSQL, not by application code.

| Invariant                                          | Enforced by                       |
| -------------------------------------------------- | --------------------------------- |
| Entries of a transaction sum to zero               | Deferred constraint trigger       |
| A transaction has at least two entries             | Same trigger                      |
| Ledger entries are never updated or deleted        | `BEFORE UPDATE OR DELETE` trigger |
| Amounts are positive integers                      | `CHECK` constraints               |
| An idempotency key maps to at most one transaction | Primary key                       |

Application-level validation can be bypassed — by a second service, a
migration script, a developer in `psql`, or a bug. A constraint in the
database cannot. The trade-off is that some business rules live in SQL rather
than TypeScript; for a ledger that is the correct side to err on.

The balance check (does the sender have enough money?) is deliberately _not_
in this table. It is not a static invariant — it depends on a point-in-time
read and must be evaluated under a lock. That belongs in the application
transaction, described below.

## Request flow

A transfer request passes through four layers:

```
HTTP request
    │
    ├─ Idempotency interceptor
    │     Has this key been seen? → replay stored response, stop.
    │
    ├─ Application service
    │     BEGIN
    │     lock both accounts (ordered by id, to avoid deadlock)
    │     read balances from ledger_entries
    │     reject if insufficient funds
    │     insert transaction + entries
    │     insert outbox event
    │     COMMIT   ← deferred trigger validates the entries here
    │
    ├─ Outbox worker (separate process)
    │     poll PENDING events with FOR UPDATE SKIP LOCKED
    │     deliver webhook, retry with backoff
    │
    └─ Response
```

Two details carry most of the weight.

Locks are taken in a fixed order (ascending account id). Two concurrent
transfers between the same pair of accounts in opposite directions would
otherwise deadlock. See ADR-0005 (added with the transfer implementation).

The outbox event is written _inside the same transaction_ as the ledger
entries. Publishing to a queue directly would create a dual-write: either the
money moves and the event is lost, or the event fires for a transfer that
rolled back. Writing both to the same database makes it atomic, and a separate
worker takes it from there. Delivery is at-least-once, so consumers must be
idempotent.

## Module layout

The backend is a modular monolith. Each module owns its tables and exposes a
service interface; modules do not read each other's tables directly.

```
modules/
  accounts/       account lifecycle, ownership
  ledger/         transactions, entries, balances  ← the core
  idempotency/    request deduplication
  outbox/         event emission and delivery
```

Within a module, the layering is:

```
domain/          pure logic and types, no I/O, no framework
application/     use cases, transaction boundaries
infrastructure/  SQL, external clients
api/             HTTP controllers, DTOs, validation
```

The `domain` layer has no imports from NestJS or `pg`. This is what makes the
interesting rules testable without a database — and it is also the boundary
that would let the ledger module become a separate service later, if it ever
needed to.

This is not full hexagonal architecture. There is no repository interface for
every table and no dependency-inversion ceremony where it buys nothing. The
split exists where it earns its cost. See
[ADR-0004](adr/0004-modular-monolith.md).

## Technology choices

PostgreSQL 16 is the only datastore, including the outbox queue: the worker
leases due events with `FOR UPDATE SKIP LOCKED`, so an event and the ledger
entries it describes commit or roll back together. Redis is provisioned in the
Compose files but is not used by the application yet.

Data access is raw SQL through `pg`, not an ORM. The system depends on
`SELECT ... FOR UPDATE`, `DEFERRABLE INITIALLY DEFERRED`, `FOR UPDATE SKIP
LOCKED`, explicit isolation levels and `ON CONFLICT` semantics — the parts
ORMs abstract away or generate unpredictably. See
[ADR-0003](adr/0003-raw-sql-over-orm.md).

Amounts are `BIGINT` in the currency's smallest unit. Never floating point.
See [ADR-0001](adr/0001-monetary-values-as-bigint.md).

## Testing strategy

Three layers, all run in CI:

Unit tests cover pure domain logic — the `Money` type, entry construction,
reversal rules. Fast, no database.

Integration tests run against a real PostgreSQL instance and verify that the
database-level invariants actually fire: unbalanced transactions are rejected
at `COMMIT`, ledger updates are refused, idempotency keys collide correctly.

Concurrency tests open multiple real connections and run transfers in
parallel: double-spend attempts, deadlock scenarios, duplicate idempotency
keys racing each other. These are the tests that justify the design, and they
cannot be written against a mock.

## What is deliberately out of scope

Multi-currency conversion, interest accrual, and scheduled transfers are not
implemented — they add surface area without exercising anything new about
correctness under concurrency.

There is no authentication beyond a stub. The interesting problems here are
transactional, not authorization.

Horizontal write scaling is not addressed. A single Postgres primary is the
correct answer at this scale, and pretending otherwise would be theatre.
