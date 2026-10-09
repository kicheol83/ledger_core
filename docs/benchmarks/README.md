# Benchmarks

Absolute figures from one laptop — load generator, API and Postgres sharing
four cores, no network in between — say nothing about production capacity.
What these runs are good for is comparison: the same scenario before and
after one change, under the same conditions. Read every number below in that
light.

## Running

```powershell
$env:LOG_LEVEL = "warn"
pnpm --filter @ledgercore/api build
pnpm --filter @ledgercore/api start *> api.log

powershell -ExecutionPolicy Bypass -File load-tests\bench.ps1
powershell -ExecutionPolicy Bypass -File load-tests\bench.ps1 -Scenarios mixed-workload
```

`bench.ps1` runs one discarded warm-up, then each scenario three times, and
reports medians over valid runs. Before every run it resets
`pg_stat_statements` and records the deadlock counter; after every run it
saves the top ten statements by total time as `slow-<scenario>-run<n>.txt`.

A run is **invalid** when any of these hold:

- `ledger_faults` > 0 (any response other than 2xx, 404, 409, 422)
- the teardown ledger check did not report `pass`
- the idempotency check reported `FAIL`
- k6 exited with anything other than 0 or 99 (99 = a latency threshold missed)
- more than 1% of iterations were dropped

`READ_RATE=<n>` switches the readers in `mixed-workload` from a closed model
(`constant-vus`) to a fixed arrival rate of `n` iterations per second. Use it
for A/B comparisons: in the closed model, a faster read path makes readers
issue more requests, which takes CPU from writers and makes an unrelated
code path look slower.

**Run the API with `LOG_LEVEL=warn`.** At `info` every request is logged, and
on Windows Node writes to stdout pipes synchronously. When the consumer
(PowerShell redirection, or the console itself) falls behind, the event loop
blocks while transactions hold row locks. See `20261009-1221-full-file-log`.

## Environment

Intel i7-8565U (4C/8T, 15 W), 15.7 GB RAM, Windows, Docker Desktop.
PostgreSQL 16.15, Node 25.0.0, k6 2.2.0. Details per run in `environment.txt`.

## Reference run

`20261009-1942-full-warn-log` — final code, `LOG_LEVEL=warn`, 12/12 valid runs.

| Scenario                                   | rps   | transfer p95 | transfer p99 | notes                                           |
| ------------------------------------------ | ----- | ------------ | ------------ | ----------------------------------------------- |
| baseline-transfers (50 VU, disjoint pairs) | 248.7 | 228 ms       | 285 ms       | misses the 150 ms p95 threshold                 |
| hot-account (40 VU, one account)           | 54.4  | 896 ms       | 1027 ms      | serialised by the row lock, 0 contention errors |
| idempotency-storm (600 keys × 3 copies)    | 170.8 | 432 ms       | 525 ms       | 600 originals, 1200 replays, money moved once   |
| mixed-workload (30 readers, 10 writers)    | 883.6 | 286 ms       | 373 ms       | balance p95 44.6 ms, history p95 45.7 ms        |

Faults 0, deadlocks 0, ledger balanced after every run.

## Index

| Folder                                    | What it measured                                        | Status                                                                  |
| ----------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `20261009-0805`                           | First full run                                          | Superseded: `LOG_LEVEL=info` to the console                             |
| `20261009-0846-pool40`                    | `mixed-workload` with `DATABASE_POOL_MAX=40`            | Diagnostic only, console logging                                        |
| `20261009-0921-balance-single-statement`  | `mixed-workload` after the balance change, closed model | Superseded: closed model and console logging made transfers look slower |
| `20261009-1119-after-rate100-console-log` | Balance change, `READ_RATE=100`, console logging        | Kept as evidence of the logging cost                                    |
| `20261009-1153-before-rate100-v2`         | **A**: old balance read, `READ_RATE=100`, logs to file  | Valid                                                                   |
| `20261009-1206-after-rate100-v2`          | **B**: single-statement balance read, same conditions   | Valid                                                                   |
| `20261009-1221-full-file-log`             | Full run, `info` logs redirected to a file              | Incident: mixed run 3 has 3 faults                                      |
| `20261009-1315-mixed-warn-log`            | `mixed-workload` with `LOG_LEVEL=warn`                  | Confirms the logging stall                                              |
| `20261009-1942-full-warn-log`             | Full run, final code                                    | Reference                                                               |

## Findings

**Balance read in one statement** (`1153` vs `1206`, 100 read iterations/s,
3 runs each): balance p95 24.9 → 13.4 ms; transfer p95 99.6 vs 104 ms and
transfers per run ~21.8k vs ~21.1k, within run-to-run noise. The old path ran
`BEGIN READ ONLY`, an account lookup, the sum and `COMMIT` — four round trips
on a dedicated connection. Under READ COMMITTED each statement takes its own
snapshot, so the transaction bought no consistency.

**Per-request logging stalled the API** (`1221`): Postgres cancelled two
statements on `lock_timeout` at 04:00:52.7 UTC; the API logged the resulting
409s ten seconds later, next to a burst of 500s within 40 ms.
With `LOG_LEVEL=warn` (`1315`) the same scenario had no faults, no 409s and
37% higher throughput. The timeouts did their job — locks were released and
the ledger stayed balanced — but statement and pool timeouts surfaced as
`500 INTERNAL_ERROR`; they now return a retryable `503 DATABASE_TIMEOUT`.

**Pool size is not the read bottleneck** (`0846`): doubling the pool moved
capacity from writers to readers without improving balance latency. Measured
under console logging, so treat it as directional.

## Known costs, not yet addressed

- A balance is a sum over the account's entries, so its cost grows with
  history: 0.42 ms mean at ~240 entries per account, 1.68 ms at ~850.
- `assert_transaction_balanced` runs three times per transfer — once per
  inserted row — and re-checks the whole transaction each time.
