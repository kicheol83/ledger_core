# LedgerCore

PostgreSQL 기반 복식부기 원장입니다. 계좌 간 이체를 기록하고, 돈이 새로 생기거나 사라지지 않게 하고, 같은 이체가 두 번 적용되지 않게 하는 것이 목표입니다.

데모: https://ledger.javohir.dev

## 주요 내용

- 잔액 컬럼이 없습니다. 잔액은 `ledger_entries` 합계로 계산합니다.
- 차변/대변 합계 같은 규칙은 deferred constraint trigger로 DB에서 검사합니다.
- 이체는 계좌 id 순서로 `SELECT ... FOR UPDATE` 해서 데드락을 피합니다.
- `Idempotency-Key`를 이체와 같은 트랜잭션에 저장해서 재시도해도 한 번만 처리됩니다.
- 이벤트는 transactional outbox로 저장하고, 워커가 `FOR UPDATE SKIP LOCKED`로 가져갑니다.
- 금액은 `BIGINT`, API에서는 문자열입니다.

설계 이유는 [docs/adr](docs/adr/)에 정리했습니다.

## 기술 스택

TypeScript, NestJS, PostgreSQL 16, pg (ORM 없음), React + Vite, Vitest, k6, Docker, Caddy

## 구조

```
apps/api     NestJS API, outbox 워커
apps/web     React 콘솔
db           마이그레이션, 시드, DB 테스트
load-tests   k6 스크립트
scripts      배포, 롤백
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

## 부하 테스트 결과

k6, 로컬 Docker 환경, 시나리오별 3회 실행 중앙값

| 시나리오 | 처리량 | p95 | deadlock | 원장 대사 |
|---|---|---|---|---|
| 일반 이체 | 248.7 req/s | 228ms | 0 | 통과 |
| 한 계좌에 집중 | 54.4 req/s | 896ms | 0 | 통과 |
| 같은 요청 재시도 | 170.8 req/s | 432ms | 0 | 통과 |
| 읽기/쓰기 혼합 | 883.6 req/s | 286ms | 0 | 통과 |

결과 파일: [docs/benchmarks/20261009-1942-full-warn-log/summary.csv](docs/benchmarks/20261009-1942-full-warn-log/summary.csv)

```bash
make load-baseline
make load-hot
make load-idempotency
make load-mixed
```

부하 테스트 중에 API가 10초 정도 멈추는 문제가 있었는데, 원인은 콘솔에 로그를 동기로 쓰는 부분이었습니다. 로그 레벨을 warn으로 바꾸고 다시 측정했습니다.

## 배포

```bash
cp .env.prod.example .env
./scripts/deploy.sh
./scripts/rollback.sh
```

커밋 SHA로 이미지를 태그하고, `/v1/health/ready`가 정상일 때만 배포를 완료합니다. 롤백은 이전 SHA 이미지로 다시 띄웁니다. 마이그레이션은 되돌리지 않기 때문에 이전 버전과 호환되게 작성합니다.

## 개선할 점

- 인증은 아직 간단한 스텁입니다.
- 계좌가 아주 커지면 잔액 스냅샷 테이블이 필요할 수 있습니다.
