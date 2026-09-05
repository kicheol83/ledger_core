# Complete file map

Every file in this repository, with nothing omitted. 171 files across 60
directories.

Two markers appear throughout:

- **[gen]** — created by a command, never typed by hand
- **[exec]** — needs the execute bit (`chmod +x`), which a copy-paste loses

Files not listed here do not belong in the repository. If something appears
that is not on this list, it is either generated (and should be gitignored)
or it does not belong.

---

## Tree

```
ledgercore/
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   ├── dependabot.yml
│   └── pull_request_template.md
├── .husky/
│   ├── commit-msg
│   └── pre-commit
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── app.config.spec.ts
│   │   │   │   ├── app.config.ts
│   │   │   │   ├── config.module.ts
│   │   │   │   ├── env.validation.spec.ts
│   │   │   │   └── env.validation.ts
│   │   │   ├── health/
│   │   │   │   ├── health.controller.ts
│   │   │   │   └── readiness.controller.ts
│   │   │   ├── modules/
│   │   │   │   ├── accounts/
│   │   │   │   │   ├── api/
│   │   │   │   │   │   ├── account.controller.ts
│   │   │   │   │   │   └── account.dto.ts
│   │   │   │   │   ├── application/
│   │   │   │   │   │   └── account.service.ts
│   │   │   │   │   ├── domain/
│   │   │   │   │   │   ├── account.spec.ts
│   │   │   │   │   │   └── account.ts
│   │   │   │   │   ├── infrastructure/
│   │   │   │   │   │   └── account.repository.ts
│   │   │   │   │   └── accounts.module.ts
│   │   │   │   ├── idempotency/
│   │   │   │   │   ├── api/
│   │   │   │   │   │   └── idempotency.interceptor.ts
│   │   │   │   │   ├── domain/
│   │   │   │   │   │   ├── request-hash.spec.ts
│   │   │   │   │   │   └── request-hash.ts
│   │   │   │   │   ├── infrastructure/
│   │   │   │   │   │   └── idempotency.repository.ts
│   │   │   │   │   └── idempotency.module.ts
│   │   │   │   ├── ledger/
│   │   │   │   │   ├── api/
│   │   │   │   │   │   ├── balance.controller.ts
│   │   │   │   │   │   ├── funding.controller.ts
│   │   │   │   │   │   ├── reversal.controller.ts
│   │   │   │   │   │   └── transfer.controller.ts
│   │   │   │   │   ├── application/
│   │   │   │   │   │   ├── balance.service.ts
│   │   │   │   │   │   ├── funding.service.ts
│   │   │   │   │   │   ├── reversal.service.ts
│   │   │   │   │   │   └── transfer.service.ts
│   │   │   │   │   ├── domain/
│   │   │   │   │   │   ├── balance.ts
│   │   │   │   │   │   ├── ledger-entry.ts
│   │   │   │   │   │   └── ledger.spec.ts
│   │   │   │   │   ├── infrastructure/
│   │   │   │   │   │   ├── balance.repository.ts
│   │   │   │   │   │   └── transaction.repository.ts
│   │   │   │   │   └── ledger.module.ts
│   │   │   │   └── outbox/
│   │   │   │       ├── api/
│   │   │   │       │   └── outbox.controller.ts
│   │   │   │       ├── application/
│   │   │   │       │   ├── outbox-worker.service.ts
│   │   │   │       │   └── outbox.service.ts
│   │   │   │       ├── domain/
│   │   │   │       │   └── event.ts
│   │   │   │       ├── infrastructure/
│   │   │   │       │   ├── outbox.repository.ts
│   │   │   │       │   ├── webhook.publisher.spec.ts
│   │   │   │       │   └── webhook.publisher.ts
│   │   │   │       └── outbox.module.ts
│   │   │   ├── shared/
│   │   │   │   ├── database/
│   │   │   │   │   ├── database.module.ts
│   │   │   │   │   ├── executor.ts
│   │   │   │   │   ├── pg-pool.provider.ts
│   │   │   │   │   └── transaction.manager.ts
│   │   │   │   ├── errors/
│   │   │   │   │   ├── domain.error.ts
│   │   │   │   │   ├── error.filter.ts
│   │   │   │   │   ├── errors.spec.ts
│   │   │   │   │   ├── ledger.errors.ts
│   │   │   │   │   └── postgres-error.translator.ts
│   │   │   │   ├── money/
│   │   │   │   │   ├── currency.ts
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── money.spec.ts
│   │   │   │   │   └── money.ts
│   │   │   │   ├── observability/
│   │   │   │   │   ├── observability.module.ts
│   │   │   │   │   ├── observability.spec.ts
│   │   │   │   │   ├── request-context.ts
│   │   │   │   │   ├── request-logging.middleware.ts
│   │   │   │   │   └── structured-logger.ts
│   │   │   │   └── validation/
│   │   │   │       └── zod-validation.pipe.ts
│   │   │   ├── app.module.ts
│   │   │   ├── main.ts
│   │   │   └── worker.ts
│   │   ├── test/
│   │   │   ├── concurrency/
│   │   │   │   └── transfer-concurrency.test.ts
│   │   │   ├── integration/
│   │   │   │   ├── accounts.test.ts
│   │   │   │   ├── balance.test.ts
│   │   │   │   ├── error-filter.test.ts
│   │   │   │   ├── funding.test.ts
│   │   │   │   ├── idempotency.test.ts
│   │   │   │   ├── outbox-worker.test.ts
│   │   │   │   ├── outbox.test.ts
│   │   │   │   ├── partitioning.test.ts
│   │   │   │   ├── reversal.test.ts
│   │   │   │   ├── tracing.test.ts
│   │   │   │   ├── transaction-manager.test.ts
│   │   │   │   └── transfer.test.ts
│   │   │   └── setup/
│   │   │       └── global-setup.ts
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   │   ├── Shell.css
│       │   │   ├── Shell.tsx
│       │   │   ├── state.css
│       │   │   └── state.tsx
│       │   ├── lib/
│       │   │   ├── api.ts
│       │   │   ├── money.spec.ts
│       │   │   ├── money.ts
│       │   │   ├── types.ts
│       │   │   └── useAsync.ts
│       │   ├── routes/
│       │   │   ├── Accounts.css
│       │   │   ├── Accounts.tsx
│       │   │   ├── Delivery.css
│       │   │   ├── Delivery.tsx
│       │   │   ├── Journal.css
│       │   │   ├── Journal.tsx
│       │   │   ├── Transfer.css
│       │   │   └── Transfer.tsx
│       │   ├── styles/
│       │   │   ├── base.css
│       │   │   └── tokens.css
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── vitest.config.ts
├── db/
│   ├── migrations/
│   │   ├── 1737000000000_enable-extensions.sql
│   │   ├── 1737000100000_create-core-ledger-schema.sql
│   │   ├── 1737000200000_enforce-double-entry-invariant.sql
│   │   ├── 1737000300000_make-ledger-immutable.sql
│   │   ├── 1737000400000_create-idempotency-keys.sql
│   │   ├── 1737000500000_create-outbox-events.sql
│   │   └── 1737000600000_partition-outbox-events.sql
│   ├── seeds/
│   │   ├── 01-system-accounts.sql
│   │   └── 99-test-helpers.sql
│   ├── test/
│   │   ├── invariants/
│   │   │   ├── constraints.test.ts
│   │   │   ├── double-entry.test.ts
│   │   │   └── immutability.test.ts
│   │   └── setup/
│   │       ├── db.ts
│   │       ├── fixtures.ts
│   │       ├── global-setup.ts
│   │       └── per-file.ts
│   ├── README.md
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── docker/
│   └── postgres/
│       ├── init/
│       │   └── 01-create-test-database.sql
│       └── postgresql.dev.conf
├── docs/
│   ├── adr/
│   │   ├── 0000-template.md
│   │   ├── 0001-monetary-values-as-bigint.md
│   │   ├── 0002-no-balance-column.md
│   │   ├── 0003-raw-sql-over-orm.md
│   │   ├── 0004-modular-monolith.md
│   │   ├── 0005-database-enforced-invariants.md
│   │   ├── 0006-locking-strategy.md
│   │   ├── 0007-partition-the-outbox.md
│   │   └── README.md
│   ├── benchmarks/
│   │   └── README.md
│   ├── diagrams/
│   │   ├── architecture.mermaid
│   │   ├── repository-map.svg
│   │   ├── request-lifecycle.mermaid
│   │   └── setup-map.svg
│   └── architecture.md
├── load-tests/
│   ├── lib/
│   │   └── api.js
│   ├── README.md
│   ├── baseline-transfers.js
│   ├── hot-account.js
│   ├── idempotency-storm.js
│   └── mixed-workload.js
├── packages/
│   └── contracts/
│       └── .gitkeep
├── .editorconfig
├── .env.example
├── .env.test
├── .eslintrc.json
├── .gitignore
├── .prettierrc
├── Makefile
├── README.md
├── SETUP.md
├── bootstrap.sh
├── commitlint.config.js
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Flat list, in the order to create them

Ordered so that nothing depends on a file that does not exist yet: workspace
definition first, then per-package manifests, then source.

### 1. Workspace root — create these first

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
.gitignore
.editorconfig
.prettierrc
.eslintrc.json
.env.example
.env.test
commitlint.config.js
docker-compose.yml
Makefile
bootstrap.sh   [exec]
README.md
SETUP.md
```

### 2. Git hooks and CI

```
.husky/commit-msg   [exec]
.husky/pre-commit   [exec]
.github/workflows/ci.yml
.github/dependabot.yml
.github/pull_request_template.md
```

### 3. Docker

```
docker/postgres/postgresql.dev.conf
docker/postgres/init/01-create-test-database.sql
```

### 4. Database package

```
db/package.json
db/tsconfig.json
db/vitest.config.ts
db/README.md
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
db/test/invariants/double-entry.test.ts
db/test/invariants/immutability.test.ts
db/test/invariants/constraints.test.ts
```

### 5. API — configuration and entry points

```
apps/api/package.json
apps/api/tsconfig.json
apps/api/nest-cli.json
apps/api/vitest.config.ts
apps/api/src/config/env.validation.ts
apps/api/src/config/env.validation.spec.ts
apps/api/src/config/app.config.ts
apps/api/src/config/app.config.spec.ts
apps/api/src/config/config.module.ts
apps/api/src/main.ts
apps/api/src/worker.ts
apps/api/src/app.module.ts
```

### 6. API — shared

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
apps/api/src/health/health.controller.ts
apps/api/src/health/readiness.controller.ts
```

### 7. API — accounts module

```
apps/api/src/modules/accounts/domain/account.ts
apps/api/src/modules/accounts/domain/account.spec.ts
apps/api/src/modules/accounts/infrastructure/account.repository.ts
apps/api/src/modules/accounts/application/account.service.ts
apps/api/src/modules/accounts/api/account.dto.ts
apps/api/src/modules/accounts/api/account.controller.ts
apps/api/src/modules/accounts/accounts.module.ts
```

### 8. API — ledger module

```
apps/api/src/modules/ledger/domain/ledger-entry.ts
apps/api/src/modules/ledger/domain/balance.ts
apps/api/src/modules/ledger/domain/ledger.spec.ts
apps/api/src/modules/ledger/infrastructure/balance.repository.ts
apps/api/src/modules/ledger/infrastructure/transaction.repository.ts
apps/api/src/modules/ledger/application/balance.service.ts
apps/api/src/modules/ledger/application/transfer.service.ts
apps/api/src/modules/ledger/application/funding.service.ts
apps/api/src/modules/ledger/application/reversal.service.ts
apps/api/src/modules/ledger/api/balance.controller.ts
apps/api/src/modules/ledger/api/transfer.controller.ts
apps/api/src/modules/ledger/api/funding.controller.ts
apps/api/src/modules/ledger/api/reversal.controller.ts
apps/api/src/modules/ledger/ledger.module.ts
```

### 9. API — idempotency module

```
apps/api/src/modules/idempotency/domain/request-hash.ts
apps/api/src/modules/idempotency/domain/request-hash.spec.ts
apps/api/src/modules/idempotency/infrastructure/idempotency.repository.ts
apps/api/src/modules/idempotency/api/idempotency.interceptor.ts
apps/api/src/modules/idempotency/idempotency.module.ts
```

### 10. API — outbox module

```
apps/api/src/modules/outbox/domain/event.ts
apps/api/src/modules/outbox/infrastructure/outbox.repository.ts
apps/api/src/modules/outbox/infrastructure/webhook.publisher.ts
apps/api/src/modules/outbox/infrastructure/webhook.publisher.spec.ts
apps/api/src/modules/outbox/application/outbox.service.ts
apps/api/src/modules/outbox/application/outbox-worker.service.ts
apps/api/src/modules/outbox/api/outbox.controller.ts
apps/api/src/modules/outbox/outbox.module.ts
```

### 11. API — tests

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

### 12. Web

```
apps/web/package.json
apps/web/tsconfig.json
apps/web/vite.config.ts
apps/web/vitest.config.ts
apps/web/index.html
apps/web/src/styles/tokens.css
apps/web/src/styles/base.css
apps/web/src/lib/money.ts
apps/web/src/lib/money.spec.ts
apps/web/src/lib/api.ts
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
apps/web/src/App.tsx
apps/web/src/main.tsx
```

### 13. Documentation

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
docs/diagrams/setup-map.svg
docs/benchmarks/README.md
```

### 14. Load tests

```
load-tests/README.md
load-tests/lib/api.js
load-tests/baseline-transfers.js
load-tests/hot-account.js
load-tests/idempotency-storm.js
load-tests/mixed-workload.js
```

### 15. Placeholder

```
packages/contracts/.gitkeep
```

---

## Verification

Files on disk: **171**. Files listed above: **171**.

Every file on disk appears in the list above. Nothing is missing.

Check it yourself after unpacking:

```bash
find . -type f -not -path './node_modules/*' -not -path './.git/*' | wc -l
# 171
```

If the count differs, something is missing or something generated has been
committed by mistake.

---

## Never created by hand

These appear after a command runs. Creating them manually breaks the build in
ways that are hard to trace:

| Path                           | Created by             | Committed          |
| ------------------------------ | ---------------------- | ------------------ |
| `node_modules/`                | `pnpm install`         | no                 |
| `pnpm-lock.yaml`               | `pnpm install`         | **yes**            |
| `.husky/_/`                    | the `prepare` script   | no                 |
| `.env`                         | `cp .env.example .env` | no                 |
| `apps/api/dist/`               | `pnpm build`           | no                 |
| `apps/web/dist/`               | `pnpm build`           | no                 |
| `coverage/`                    | `pnpm test`            | no                 |
| `*.tsbuildinfo`                | `tsc`                  | no                 |
| `pgmigrations` table           | `pnpm migrate`         | in the database    |
| `ledgercore_pg_data` volume    | `make up`              | Docker             |
| `ledgercore_redis_data` volume | `make up`              | Docker             |
| new `db/migrations/*.sql`      | `pnpm migrate:create`  | yes, after editing |

`pnpm-lock.yaml` is the one generated file that must be committed. Without it
CI resolves different dependency versions from the ones that were tested.

---

## Filenames that must not change

**Migration timestamp prefixes.** They decide the order the schema is built
in. Renaming one reorders the schema; editing a merged one means it never
runs again, because `pgmigrations` already records it as applied.

**`.husky/commit-msg` and `.husky/pre-commit`.** Husky looks these up by
name.

**`docker/postgres/init/*.sql`.** Postgres runs everything in that directory
in filename order, and only on a first start with an empty data directory.

**`db/seeds/99-test-helpers.sql`.** Deliberately numbered last, and
deliberately a seed rather than a migration — it disables integrity triggers,
so it must never reach a non-test database.
