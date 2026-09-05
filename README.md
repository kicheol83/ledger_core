# LedgerCore

PostgreSQL 기반 복식부기 원장입니다. 계좌 간 이체를 기록하고, 돈이 새로 생기거나 사라지지 않게 하고, 같은 이체가 두 번 적용되지 않게 하는 것이 목표입니다.

## 주요 내용

- 잔액 컬럼이 없습니다. 잔액은 `ledger_entries` 합계로 계산합니다.
- 차변/대변 합계 같은 규칙은 deferred constraint trigger로 DB에서 검사합니다.
- 이체는 계좌 id 순서로 `SELECT ... FOR UPDATE` 해서 데드락을 피합니다.
- `Idempotency-Key`를 이체와 같은 트랜잭션에 저장해서 재시도해도 한 번만 처리됩니다.
- 이벤트는 transactional outbox로 저장하고, 워커가 `FOR UPDATE SKIP LOCKED`로 가져갑니다.
- 금액은 `BIGINT`, API에서는 문자열입니다.

설계 이유는 [docs/adr](docs/adr/)에 정리했습니다.

## 기술 스택

TypeScript, NestJS, PostgreSQL 16, pg (ORM 없음), React + Vite, Vitest, k6, Docker

## 구조

```
apps/api     NestJS API, outbox 워커
apps/web     React 콘솔
db           마이그레이션, 시드, DB 테스트
load-tests   k6 스크립트
```

## 실행

```bash
pnpm install
cp .env.example .env
make up
pnpm migrate
psql "$DATABASE_URL" -f db/seeds/01-system-accounts.sql

pnpm --filter @ledgercore/api dev
pnpm --filter @ledgercore/api dev:worker
pnpm --filter @ledgercore/web dev
```

## 테스트

```bash
pnpm test
```

DB mock 없이 실제 PostgreSQL로 테스트합니다. 동시성 테스트에서는 잔액이 3건만 가능한 상태에서 이체 10건을 동시에 보내고 정확히 3건만 성공하는지, 반대 방향 이체에서 데드락이 없는지 확인합니다.

## 부하 테스트

```bash
make load-baseline
make load-hot
make load-idempotency
make load-mixed
```
