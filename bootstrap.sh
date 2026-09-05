#!/usr/bin/env bash

set -euo pipefail

echo "Creating directory skeleton…"

mkdir -p \
  .github/workflows \
  .husky \
  apps/api/src/config \
  apps/api/src/health \
  apps/api/src/modules/accounts/{domain,application,infrastructure,api} \
  apps/api/src/modules/ledger/{domain,application,infrastructure,api} \
  apps/api/src/modules/idempotency/{domain,infrastructure,api} \
  apps/api/src/modules/outbox/{domain,application,infrastructure,api} \
  apps/api/src/shared/{database,errors,money,observability,validation} \
  apps/api/test/{setup,integration,concurrency} \
  apps/web/src/{styles,lib,components,routes} \
  db/{migrations,seeds} \
  db/test/{setup,invariants} \
  docker/postgres/init \
  docs/{adr,diagrams,benchmarks} \
  load-tests/lib \
  packages/contracts

echo "Done. Directory tree:"
echo

find . -type d -not -path './.git*' | sort | sed 's|[^/]*/|  |g'

echo
echo "Next:"
echo "  1. place the authored files (see SETUP.md)"
echo "  2. chmod +x .husky/commit-msg .husky/pre-commit"
echo "  3. cp .env.example .env"
echo "  4. pnpm install"
