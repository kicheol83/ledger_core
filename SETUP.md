# Setup — where every file goes

Two kinds of file exist in this repository, and confusing them wastes time:

**Authored** — written by hand and committed. 159 of them. Every one is in
this guide.

**Generated** — produced by a tool and, with two exceptions, never committed.
Creating these by hand is the most common way a first setup goes wrong: a
hand-written `pnpm-lock.yaml` or a manually created `.husky/_` directory will
break in ways that are hard to diagnose.

---

## Quickest path

Download the archive, unpack it, and skip to [Step 3](#step-3--install).

```bash
tar -xzf ledgercore.tar.gz
cd ledgercore
```

Everything below is for building it by hand instead.

---

## Step 1 — directories

```bash
mkdir ledgercore && cd ledgercore
bash bootstrap.sh
```

Or without the script:

```bash
mkdir -p \
  .github/workflows .husky \
  apps/api/src/{config,health} \
  apps/api/src/modules/accounts/{domain,application,infrastructure,api} \
  apps/api/src/modules/ledger/{domain,application,infrastructure,api} \
  apps/api/src/modules/idempotency/{domain,infrastructure,api} \
  apps/api/src/modules/outbox/{domain,application,infrastructure,api} \
  apps/api/src/shared/{database,errors,money,observability,validation} \
  apps/api/test/{setup,integration,concurrency} \
  apps/web/src/{styles,lib,components,routes} \
  db/{migrations,seeds} db/test/{setup,invariants} \
  docker/postgres/init \
  docs/{adr,diagrams,benchmarks} \
  load-tests/lib packages/contracts
```

---

## Step 2 — place the authored files

### Repository root — 13 files

```
.editorconfig
.env.example
.env.test              ← committed on purpose (local container credentials only)
.eslintrc.json
.gitignore
.prettierrc
Makefile
README.md
bootstrap.sh
commitlint.config.js
docker-compose.yml
package.json
pnpm-workspace.yaml
tsconfig.base.json
```

### `.github/` — 3 files

```
.github/workflows/ci.yml
.github/dependabot.yml
.github/pull_request_template.md
```

### `.husky/` — 2 files

```
.husky/commit-msg
.husky/pre-commit
```

Both need the execute bit, which git preserves but a copy-paste does not:

```bash
chmod +x .husky/commit-msg .husky/pre-commit
```

### `docker/` — 2 files

```
docker/postgres/postgresql.dev.conf
docker/postgres/init/01-create-test-database.sql
```

### `db/` — 15 files

```
db/README.md
db/package.json
db/tsconfig.json
db/vitest.config.ts

db/migrations/1737000000000_enable-extensions.sql
db/migrations/1737000100000_create-core-ledger-schema.sql
db/migrations/1737000200000_enforce-double-entry-invariant.sql
db/migrations/1737000300000_make-ledger-immutable.sql
db/migrations/1737000400000_create-idempotency-keys.sql
db/migrations/1737000500000_create-outbox-events.sql
db/migrations/1737000600000_partition-outbox-events.sql

db/seeds/01-system-accounts.sql
db/seeds/99-test-helpers.sql

db/test/setup/db.ts
db/test/setup/fixtures.ts
db/test/setup/global-setup.ts
db/test/setup/per-file.ts
db/test/invariants/constraints.test.ts
db/test/invariants/double-entry.test.ts
db/test/invariants/immutability.test.ts
```

**Migration filenames must keep their timestamp prefixes exactly.** The
prefix determines apply order; renaming one reorders the schema.

### `apps/api/` — 79 files

Config and entry points:

```
apps/api/package.json
apps/api/tsconfig.json
apps/api/nest-cli.json
apps/api/vitest.config.ts
apps/api/src/main.ts               ← API process
apps/api/src/worker.ts             ← worker process
apps/api/src/app.module.ts
```

Configuration:

```
apps/api/src/config/env.validation.ts
apps/api/src/config/env.validation.spec.ts
apps/api/src/config/app.config.ts
apps/api/src/config/app.config.spec.ts
apps/api/src/config/config.module.ts
```

Health:

```
apps/api/src/health/health.controller.ts
apps/api/src/health/readiness.controller.ts
```

Shared:

```
apps/api/src/shared/database/executor.ts
apps/api/src/shared/database/pg-pool.provider.ts
apps/api/src/shared/database/transaction.manager.ts
apps/api/src/shared/database/database.module.ts

apps/api/src/shared/errors/domain.error.ts
apps/api/src/shared/errors/ledger.errors.ts
apps/api/src/shared/errors/postgres-error.translator.ts
apps/api/src/shared/errors/error.filter.ts
apps/api/src/shared/errors/errors.spec.ts

apps/api/src/shared/money/currency.ts
apps/api/src/shared/money/money.ts
apps/api/src/shared/money/money.spec.ts
apps/api/src/shared/money/index.ts

apps/api/src/shared/observability/request-context.ts
apps/api/src/shared/observability/structured-logger.ts
apps/api/src/shared/observability/request-logging.middleware.ts
apps/api/src/shared/observability/observability.module.ts
apps/api/src/shared/observability/observability.spec.ts

apps/api/src/shared/validation/zod-validation.pipe.ts
```

Modules — each follows `domain / application / infrastructure / api`:

```
apps/api/src/modules/accounts/domain/account.ts
apps/api/src/modules/accounts/domain/account.spec.ts
apps/api/src/modules/accounts/application/account.service.ts
apps/api/src/modules/accounts/infrastructure/account.repository.ts
apps/api/src/modules/accounts/api/account.dto.ts
apps/api/src/modules/accounts/api/account.controller.ts
apps/api/src/modules/accounts/accounts.module.ts

apps/api/src/modules/ledger/domain/ledger-entry.ts
apps/api/src/modules/ledger/domain/balance.ts
apps/api/src/modules/ledger/domain/ledger.spec.ts
apps/api/src/modules/ledger/application/balance.service.ts
apps/api/src/modules/ledger/application/transfer.service.ts
apps/api/src/modules/ledger/application/funding.service.ts
apps/api/src/modules/ledger/application/reversal.service.ts
apps/api/src/modules/ledger/infrastructure/balance.repository.ts
apps/api/src/modules/ledger/infrastructure/transaction.repository.ts
apps/api/src/modules/ledger/api/balance.controller.ts
apps/api/src/modules/ledger/api/transfer.controller.ts
apps/api/src/modules/ledger/api/funding.controller.ts
apps/api/src/modules/ledger/api/reversal.controller.ts
apps/api/src/modules/ledger/ledger.module.ts

apps/api/src/modules/idempotency/domain/request-hash.ts
apps/api/src/modules/idempotency/domain/request-hash.spec.ts
apps/api/src/modules/idempotency/infrastructure/idempotency.repository.ts
apps/api/src/modules/idempotency/api/idempotency.interceptor.ts
apps/api/src/modules/idempotency/idempotency.module.ts

apps/api/src/modules/outbox/domain/event.ts
apps/api/src/modules/outbox/application/outbox.service.ts
apps/api/src/modules/outbox/application/outbox-worker.service.ts
apps/api/src/modules/outbox/infrastructure/outbox.repository.ts
apps/api/src/modules/outbox/infrastructure/webhook.publisher.ts
apps/api/src/modules/outbox/infrastructure/webhook.publisher.spec.ts
apps/api/src/modules/outbox/api/outbox.controller.ts
apps/api/src/modules/outbox/outbox.module.ts
```

Tests:

```
apps/api/test/setup/global-setup.ts
apps/api/test/integration/transaction-manager.test.ts
apps/api/test/integration/error-filter.test.ts
apps/api/test/integration/accounts.test.ts
apps/api/test/integration/balance.test.ts
apps/api/test/integration/transfer.test.ts
apps/api/test/integration/funding.test.ts
apps/api/test/integration/reversal.test.ts
apps/api/test/integration/idempotency.test.ts
apps/api/test/integration/outbox.test.ts
apps/api/test/integration/outbox-worker.test.ts
apps/api/test/integration/partitioning.test.ts
apps/api/test/integration/tracing.test.ts
apps/api/test/concurrency/transfer-concurrency.test.ts
```

### `apps/web/` — 24 files

```
apps/web/package.json
apps/web/tsconfig.json
apps/web/vite.config.ts
apps/web/vitest.config.ts
apps/web/index.html

apps/web/src/main.tsx
apps/web/src/App.tsx

apps/web/src/styles/tokens.css
apps/web/src/styles/base.css

apps/web/src/lib/api.ts
apps/web/src/lib/money.ts
apps/web/src/lib/money.spec.ts
apps/web/src/lib/types.ts
apps/web/src/lib/useAsync.ts

apps/web/src/components/Shell.tsx
apps/web/src/components/Shell.css
apps/web/src/components/state.tsx
apps/web/src/components/state.css

apps/web/src/routes/Accounts.tsx
apps/web/src/routes/Accounts.css
apps/web/src/routes/Transfer.tsx
apps/web/src/routes/Transfer.css
apps/web/src/routes/Journal.tsx
apps/web/src/routes/Journal.css
apps/web/src/routes/Delivery.tsx
apps/web/src/routes/Delivery.css
```

### `docs/` — 14 files

```
docs/architecture.md
docs/adr/README.md
docs/adr/0000-template.md
docs/adr/0001-monetary-values-as-bigint.md
docs/adr/0002-no-balance-column.md
docs/adr/0003-raw-sql-over-orm.md
docs/adr/0004-modular-monolith.md
docs/adr/0005-database-enforced-invariants.md
docs/adr/0006-locking-strategy.md
docs/adr/0007-partition-the-outbox.md
docs/diagrams/architecture.mermaid
docs/diagrams/request-lifecycle.mermaid
docs/diagrams/repository-map.svg
docs/benchmarks/README.md
```

### `load-tests/` — 6 files

```
load-tests/README.md
load-tests/lib/api.js
load-tests/baseline-transfers.js
load-tests/hot-account.js
load-tests/idempotency-storm.js
load-tests/mixed-workload.js
```

### `packages/contracts/` — placeholder

Empty for now. Either fill it with the API types shared between `apps/api`
and `apps/web`, or remove it from `pnpm-workspace.yaml` and delete it — an
empty workspace package is a loose end a reviewer will notice.

```bash
touch packages/contracts/.gitkeep
```

---

## Step 3 — install

```bash
cd ledgercore
git init
chmod +x .husky/commit-msg .husky/pre-commit
cp .env.example .env
pnpm install
```

`pnpm install` generates several things. None of them are written by hand:

| Generated            | By                   | Committed?                                 |
| -------------------- | -------------------- | ------------------------------------------ |
| `node_modules/`      | `pnpm install`       | No — in `.gitignore`                       |
| `pnpm-lock.yaml`     | `pnpm install`       | **Yes** — it is what makes CI reproducible |
| `.husky/_/`          | the `prepare` script | No                                         |
| `.git/hooks/` wiring | husky                | No                                         |

`.env` is also generated, by copying `.env.example`. It is gitignored because
it holds real credentials in every environment except this one.

---

## Step 4 — infrastructure

```bash
make up          # postgres + redis, waits until healthy
make ps          # both should read "healthy"
```

Docker generates two named volumes on first start. They persist between
restarts and hold the database:

| Generated               | Where         |
| ----------------------- | ------------- |
| `ledgercore_pg_data`    | Docker volume |
| `ledgercore_redis_data` | Docker volume |

`make reset` destroys both and starts clean.

The init script inside `docker/postgres/init/` runs **only on the first
start**, when the data directory is empty. If you add to it later, you have
to `make reset` for it to run.

---

## Step 5 — schema

```bash
pnpm migrate                                        # apply migrations
psql "$DATABASE_URL" -f db/seeds/01-system-accounts.sql
```

`pnpm migrate` generates one table you never write yourself:

| Generated            | What it is                |
| -------------------- | ------------------------- |
| `pgmigrations` table | Which migrations have run |

That table is why **a merged migration must never be edited**: it records the
file as applied, so changed content never runs and environments silently
diverge.

---

## Step 6 — run

Three processes, three terminals:

```bash
pnpm --filter @ledgercore/api dev            # :3000
pnpm --filter @ledgercore/api dev:worker     # no port, drains the outbox
pnpm --filter @ledgercore/web dev            # :5173
```

Building generates output directories, all gitignored:

| Generated        | By                        |
| ---------------- | ------------------------- |
| `apps/api/dist/` | `pnpm build`              |
| `apps/web/dist/` | `pnpm build`              |
| `coverage/`      | `pnpm test` with coverage |
| `*.tsbuildinfo`  | `tsc`                     |

---

## Step 7 — new files you will generate later

Two things should always be created by a tool rather than by hand:

**New migrations.** The timestamp prefix has to be right, and typing one is
how two branches end up with colliding filenames:

```bash
pnpm migrate:create add-something-useful
# → db/migrations/<timestamp>_add-something-useful.sql
```

**Commits.** The hooks validate the message, so `git commit` will reject a
message that does not follow the scoped Conventional Commits format:

```bash
git commit -m "feat(ledger): add partial reversals"
# feat(nonsense): … → rejected by commitlint
```

---

## First-run checklist

```bash
pnpm install          # no errors
pnpm typecheck        # expect failures — see the known issues below
make up && make ps    # both healthy
pnpm migrate          # applies 7 migrations
pnpm migrate:redo     # proves the last one is reversible
pnpm test             # the real goal
```

`pnpm typecheck` will not pass on a fresh copy. The known causes, in the
order worth fixing them:

1. **`apps/api/tsconfig.json`** — `module: CommonJS` with `.js` import
   specifiers cannot resolve. Switch to `"module": "NodeNext"`,
   `"moduleResolution": "NodeNext"`, and add `"type": "module"` to
   `apps/api/package.json`.
2. **`supertest@7`** removed the `SuperTest<Test>` type. Drop the annotation:
   `const http = () => request(app.getHttpServer());`
3. **`JSX.Element`** is not global in every React 18 setup. Use
   `React.JSX.Element` or import the namespace.
4. **`exactOptionalPropertyTypes`** and **`noUncheckedIndexedAccess`** are on
   deliberately and will surface real null-safety gaps. Fix them rather than
   turning the flags off.
5. **`transfer.service.ts`** uses `source.type.includes('SYSTEM')` where it
   should be `===`.
