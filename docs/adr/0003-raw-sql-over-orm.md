# ADR-0003: Raw SQL instead of an ORM

Date: 2026-08-18

## Context

The important parts of this project are PostgreSQL features: `SELECT ... FOR UPDATE` in a fixed order, deferred constraint triggers, `SKIP LOCKED`, partitioned tables. ORMs usually hide these or make them awkward.

## Decision

Use `pg` with plain SQL. Queries live only in the `infrastructure` folder of each module. Each query has its own row type.

Kysely was the strongest alternative. If the project had much more CRUD, I would pick Kysely.

## Consequences

The compiler does not check SQL. Integration tests against a real Postgres do that instead.
