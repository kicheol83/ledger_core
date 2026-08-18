# ADR-0001: Represent monetary values as BIGINT minor units

- **Status:** Accepted
- **Date:** 2026-01-15

## Context

Every amount in this system is money. It gets stored, summed, compared against
balances, split across entries, and serialized over HTTP and JSON. A
representation error anywhere in that chain is a correctness bug, not a
rounding annoyance.

The system must support currencies with different minor-unit conventions:
UZS and KRW have no commonly used subunit in practice, USD has two decimal
places, and some currencies have three.

## Options considered

### IEEE 754 floating point (`double precision`, JS `number`)

Binary floating point cannot represent most decimal fractions exactly.
`0.1 + 0.2 === 0.30000000000000004` is the familiar example, but the failure
that matters here is cumulative: summing thousands of ledger entries drifts,
and a drifted sum compared against a stored value will eventually disagree.
Disqualified.

### `NUMERIC(20, 4)` in Postgres, string in TypeScript

Exact decimal arithmetic in the database, no drift. This is a legitimate
choice and many real ledgers use it.

The problem is the application side. Postgres returns `NUMERIC` to `node-pg`
as a string, so arithmetic requires a decimal library and every value must be
converted at the boundary. It works, but it puts a fallible conversion step
between the database and every calculation, and nothing in the type system
prevents someone writing `Number(row.amount)` and reintroducing floats.

`NUMERIC` is also slower to sum and index than an integer type, which matters
because balance derivation aggregates over entries.

### `BIGINT` storing minor units

Store 10,000.50 USD as `1000050` cents. All arithmetic is exact integer
arithmetic. Summation, comparison and indexing are as fast as Postgres gets.

The range is the obvious question. `BIGINT` holds up to ~9.22 × 10^18. In
cents that is roughly 92 quadrillion USD; in UZS minor units it still exceeds
any plausible total by many orders of magnitude. Not a practical constraint.

The real cost is JavaScript. `Number.MAX_SAFE_INTEGER` is ~9 × 10^15, so a
`BIGINT` cannot be safely read into a JS `number`. `node-pg` returns `int8` as
a string by default precisely because of this, and that default must not be
overridden.

## Decision

Store all monetary values as `BIGINT` in the currency's minor unit.

In TypeScript, wrap them in a `Money` value object backed by `bigint`, which
carries its currency and refuses arithmetic between mismatched currencies.
Serialize to JSON as a string plus a currency code — never as a JSON number,
since JSON numbers are IEEE 754 and would undo the guarantee at the API
boundary:

```json
{ "amount": "1000050", "currency": "USD" }
```

Minor-unit exponents per currency live in one table in the `Money` module, so
formatting for display is a presentation concern and never touches stored
values.

## Consequences

Arithmetic is exact everywhere, with no decimal library and no conversion
layer between database and application.

Aggregation over `ledger_entries` — the hottest query in the system — is
integer summation, which is what makes deriving balances from entries viable
at all (see ADR-0002).

The cost is ergonomic. `bigint` does not mix with `number` in TypeScript, so
every amount must be explicitly converted at the edges, and `JSON.stringify`
throws on raw `bigint`. Both are handled once, inside `Money`, and the
compiler enforces it from there.

Clients must treat `amount` as an opaque string. A client that does
`parseFloat(response.amount)` reintroduces the exact bug this decision avoids.
This is documented in the API contract and asserted in contract tests.

## Revisit if

The system needs to record fractional minor units — for example interest
accrual at sub-cent precision, or FX rates applied to balances. That would
require either a scaled integer with a larger exponent or a move to `NUMERIC`.
