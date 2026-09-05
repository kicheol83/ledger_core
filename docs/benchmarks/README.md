# Benchmarks

Output from load-test runs is written here.

Deliberately not committed with numbers from a developer machine as though
they were meaningful: absolute figures from one laptop with no network
between the API and the database say nothing about production capacity, and
publishing them invites exactly that misreading.

What is worth capturing here is a comparison — the same scenario before and
after a change — which is the only form in which these numbers carry
information.

```bash
docker compose exec postgres psql -U ledger -d ledgercore \
  -c 'SELECT pg_stat_statements_reset()'

make load-baseline
make slow > docs/benchmarks/baseline-$(date +%Y%m%d).txt
```

Reset the statistics first, or the output includes every query since the
container started — migrations and fixture setup included.
