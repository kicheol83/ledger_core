# ADR-0004: Build a modular monolith, not microservices

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The system has four cohesive areas of responsibility: accounts, the ledger
itself, idempotency, and outbox delivery. They could be separate services or
modules inside one deployable.

The decisive constraint is that a transfer must be atomic across the ledger
entries _and_ the outbox event. If those live in different services with
different databases, atomicity is gone and the only remaining options are
distributed transactions or a saga — both of which introduce failure modes far
worse than the coupling they remove.

## Options considered

### Microservices per bounded context

Independent deployment and scaling. Bought at the price of a distributed
transaction across the ledger write and the event write, plus network failure
handling on every internal call.

There is no scaling requirement here that a single Postgres primary cannot
meet, so this pays a large correctness cost for a benefit that is not needed.

### Layered monolith (controllers / services / repositories)

The conventional structure: all controllers together, all services together.
It works, but the layout carries no information about what the system does,
and over time cross-module calls accumulate because nothing marks a boundary.

### Modular monolith

One deployable, one database, but modules that own their tables and expose
service interfaces. Boundaries are explicit and enforced by lint rules on
import paths, even though nothing physically prevents crossing them.

## Decision

A modular monolith. Modules: `accounts`, `ledger`, `idempotency`, `outbox`.

A module may not query another module's tables. Cross-module access goes
through the owning module's application service.

Within each module:

```
domain/          pure logic and types — no NestJS, no pg imports
application/     use cases; owns transaction boundaries
infrastructure/  SQL and external clients
api/             HTTP controllers, DTOs, validation
```

The `domain` layer's isolation is enforced by an ESLint import restriction, so
a framework import there fails CI rather than review.

Full hexagonal architecture is explicitly not adopted: there is no port
interface for every repository and no dependency inversion where the only
implementation is Postgres and always will be. The layering exists where it
buys testability of real logic.

The outbox worker runs in the same codebase but as a separate process, so it
can be scaled and restarted independently of the API without splitting the
transaction boundary.

## Consequences

A transfer and its outbox event commit atomically in one database
transaction — the property the whole design depends on.

Local development and testing need one process and one database. Concurrency
tests can drive real parallel connections without orchestrating services.

Module boundaries make the extraction path clear if it is ever needed: the
ledger module's dependencies are explicit, so it could become a service
without an archaeology exercise first.

The costs: the whole application deploys as a unit, so an unrelated change
redeploys the ledger. Modules cannot be scaled independently, except the
worker. And boundaries are conventions plus lint rules, not physical
separation — discipline is required, and a determined shortcut is one import
away.

## Revisit if

A module develops a genuinely different scaling profile or availability
requirement — for example a reporting module whose heavy reads interfere with
transfer latency. The first response is a read replica, not a service split.
