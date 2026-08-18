# ADR-0001: Money as BIGINT minor units

Date: 2026-08-18

## Context

Amounts are summed, compared and sent over JSON. JSON numbers are doubles, so big amounts can lose precision without any error.

## Decision

- Store amounts as `BIGINT` in the minor unit (for KRW this is just won).
- In TypeScript use a `Money` class based on `bigint`. It does not allow math between different currencies.
- In the API, amounts are strings, not numbers.

I also looked at `NUMERIC`. It is exact too, but the `pg` driver returns it as a string and every place needs conversion anyway.

## Consequences

Clients have to read amounts as strings. In return there is no rounding problem anywhere.
