# Architecture Decision Records

Each record captures one decision: the constraints at the time, the options
considered, what was chosen, and what it costs. Records are immutable once
merged — a decision that changes gets a new record that supersedes the old one.

| #                                            | Decision                                         | Status   |
| -------------------------------------------- | ------------------------------------------------ | -------- |
| [0001](0001-monetary-values-as-bigint.md)    | Monetary values as BIGINT minor units            | Accepted |
| [0002](0002-no-balance-column.md)            | No balance column; balances derived from entries | Accepted |
| [0003](0003-raw-sql-over-orm.md)             | Raw SQL instead of an ORM                        | Accepted |
| [0004](0004-modular-monolith.md)             | Modular monolith over microservices              | Accepted |
| [0005](0005-database-enforced-invariants.md) | Ledger invariants enforced in the database       | Accepted |
| [0006](0006-locking-strategy.md)             | Ordered row locks instead of SERIALIZABLE        | Accepted |
| [0007](0007-partition-the-outbox.md)         | Partition the outbox, not the ledger             | Accepted |

Use [0000-template.md](0000-template.md) for new records.
