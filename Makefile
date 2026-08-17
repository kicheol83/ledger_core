.DEFAULT_GOAL := help
.PHONY: help up down reset logs psql redis-cli ps locks slow \
	load-baseline load-hot load-idempotency load-mixed load-all stats-reset

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start postgres and redis, wait until healthy
	docker compose up -d --wait

down: ## Stop containers, keep data
	docker compose down

reset: ## Destroy all data and start fresh
	docker compose down -v
	docker compose up -d --wait

ps: ## Show container status
	docker compose ps

logs: ## Tail postgres logs (shows every query, lock wait and deadlock)
	docker compose logs -f postgres

psql: ## Open a psql shell on the dev database
	docker compose exec postgres psql -U ledger -d ledgercore

redis-cli: ## Open a redis shell
	docker compose exec redis redis-cli

locks: ## Show current lock waits — who is blocking whom
	docker compose exec postgres psql -U ledger -d ledgercore -c "\
		SELECT blocked.pid AS blocked_pid, \
		       blocked.query AS blocked_query, \
		       blocking.pid AS blocking_pid, \
		       blocking.query AS blocking_query, \
		       blocked.wait_event_type, blocked.wait_event \
		FROM pg_stat_activity blocked \
		JOIN pg_stat_activity blocking \
		  ON blocking.pid = ANY(pg_blocking_pids(blocked.pid)) \
		WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0;"

slow: ## Show the 10 slowest statements by total time
	docker compose exec postgres psql -U ledger -d ledgercore -c "\
		SELECT calls, \
		       round(total_exec_time::numeric, 1) AS total_ms, \
		       round(mean_exec_time::numeric, 2) AS mean_ms, \
		       left(query, 90) AS query \
		FROM pg_stat_statements \
		ORDER BY total_exec_time DESC LIMIT 10;"

stats-reset: ## Reset pg_stat_statements before a measured run
	docker compose exec postgres psql -U ledger -d ledgercore \
		-c 'SELECT pg_stat_statements_reset()' > /dev/null
	@echo "statistics reset"

load-baseline: stats-reset ## Transfer cost with no contention
	k6 run load-tests/baseline-transfers.js

load-hot: stats-reset ## Contention on a single account
	k6 run load-tests/hot-account.js

load-idempotency: stats-reset ## Concurrent retries of the same request
	k6 run load-tests/idempotency-storm.js

load-mixed: stats-reset ## Reads and writes together
	k6 run load-tests/mixed-workload.js

load-all: ## Every scenario in sequence
	$(MAKE) load-baseline
	$(MAKE) load-hot
	$(MAKE) load-idempotency
	$(MAKE) load-mixed
