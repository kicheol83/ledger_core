# What

<!-- One paragraph: what this PR changes. -->

# Why

<!-- The problem being solved. Link the ADR if this introduces a decision. -->

# Correctness notes

<!--
For anything touching the ledger, answer explicitly:
- Which invariants does this preserve or affect?
- What happens if two requests run this concurrently?
- Which locks are taken, and in what order?
Write "N/A" if this PR does not touch transactional code.
-->

# Testing

- [ ] Unit tests
- [ ] Integration tests against a real PostgreSQL instance
- [ ] Concurrency test (if this path can run in parallel)

# Checklist

- [ ] Migrations are reversible
- [ ] No `any` types introduced
- [ ] ADR added or updated if this changes an architectural decision
