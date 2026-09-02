# Load tests

Four scenarios, each answering one question. Run them against a local stack;
the numbers are only comparable to each other, not to any production system.

```bash
make up
pnpm migrate
psql "$DATABASE_URL" -f db/seeds/01-system-accounts.sql
pnpm --filter @ledgercore/api dev

# in another terminal
make load-baseline
make load-hot
make load-idempotency
make load-mixed
```

## What each one measures

**`baseline-transfers.js`** — the cost of a transfer with contention removed.
Every VU owns its own pair of accounts, so no two transfers touch the same
row. This is the floor: the transaction, the row locks, the balance
derivation and the deferred trigger, and nothing else. Every other number is
read against this one.

**`hot-account.js`** — every VU transferring out of the same account. This is
the case ADR-0006 exists for. Latency should rise with concurrency, because
transfers are queueing on the row lock, and throughput should plateau rather
than collapse. Zero deadlocks: a `40P01` here would mean the ascending-id
lock ordering is not doing its job.

**`idempotency-storm.js`** — the same request sent three times over,
concurrently, thirty VUs deep. Reproduces a gateway timing out and retrying
while the original is in flight. The assertion is not latency but the final
balance: money moved once per key, not once per request.

**`mixed-workload.js`** — reads and writes together in roughly the ratio a
payments API sees. The check is that balance reads stay fast while writes
hold row locks; if read latency tracks write load, something is blocking the
balance query that should not be.

## Reading the results

The custom metrics separate outcomes that a single error rate would conflate:

| Metric                     | Meaning                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `ledger_succeeded`         | 2xx — the operation happened                                      |
| `ledger_rejected_business` | 422/404 — correctly refused (insufficient funds, unknown account) |
| `ledger_contention`        | 409 — lock timeout or concurrency conflict                        |
| `ledger_faults`            | 5xx or transport failure — the only real errors                   |

A contention run showing thousands of `rejected_business` is working
correctly. The same count under `faults` is a defect. This is why the
thresholds fail on `ledger_fault_rate` rather than on `http_req_failed`
alone.

Every scenario ends by calling `/ledger/reconciliation`. Throughput numbers
are worthless if the ledger stopped balancing under load, so that check
matters more than any percentile in the output.

## While a run is in progress

```bash
make locks    # who is blocking whom, live
make slow     # slowest statements by total time
```

`make locks` during `hot-account.js` shows the queue on the source account
row — the design working, made visible.

## Capturing a run for the README

```bash
docker compose exec postgres psql -U ledger -d ledgercore \
  -c 'SELECT pg_stat_statements_reset()'

make load-baseline

make slow > docs/benchmarks/baseline-statements.txt
```

Reset statistics first or the numbers include every query since the container
started, including migrations and fixture setup.

## What these do not measure

A single Postgres instance on one developer machine, with the API in the same
process tree and no network between them. Absolute numbers say nothing about
production capacity.

What they do establish is the _shape_: that disjoint transfers do not
contend, that a hot account queues rather than deadlocks, that retries
deduplicate, and that the ledger balances afterwards. Those properties are
what the design claims, and they hold or fail regardless of hardware.
