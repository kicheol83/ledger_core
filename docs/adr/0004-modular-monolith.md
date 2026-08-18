# ADR-0004: Modular monolith

Date: 2026-08-18

## Context

There are four areas: accounts, ledger, idempotency and outbox. A transfer must write entries, the idempotency key and the outbox event in one transaction.

## Decision

One deployable with modules `accounts`, `ledger`, `idempotency`, `outbox`. A module does not query another module's tables directly.

The `domain` folder must not import `pg` or `@nestjs`. An ESLint rule checks this in CI.

## Consequences

Splitting into services later is possible, but then the single transaction would need a saga. For now one transaction is simpler and safer.
