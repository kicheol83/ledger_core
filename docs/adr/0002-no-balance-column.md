# ADR-0002: No balance column

Date: 2026-08-18

## Context

A `balance` column on `accounts` is simple, but if one code path updates entries and forgets the balance (or the other way around), the two values disagree and there is no way to know which one is right.

## Decision

There is no `balance` column. The balance is the sum of `ledger_entries` for the account.

A covering index on `(account_id, id) INCLUDE (direction, amount)` keeps the query index-only. An integration test checks the plan.

## Consequences

Reading a balance is an aggregate instead of a lookup. If accounts get very large, a snapshot table can be added later without changing this rule.
