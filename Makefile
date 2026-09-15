SHELL := /bin/bash

DEV_PORT := 8057

.PHONY: build test lint fmt format-check typecheck checkall pre-commit dev dev-stop dev-restart browser-test browser-install

build:
	bun run build

test:
	bun run test

lint:
	bun run lint

fmt:
	bun run format

format-check:
	bun run format:check

typecheck:
	bun run typecheck

checkall: format-check lint typecheck test build

pre-commit:
	pre-commit run --all-files

dev:
	bun run dev

dev-stop:
	@set -euo pipefail; \
	pids="$$(lsof -tiTCP:$(DEV_PORT) -sTCP:LISTEN 2>/dev/null || true)"; \
	if [[ -z "$$pids" ]]; then exit 0; fi; \
	kill -TERM $$pids 2>/dev/null || true; \
	for _ in $$(seq 1 20); do \
		if ! lsof -tiTCP:$(DEV_PORT) -sTCP:LISTEN >/dev/null 2>&1; then exit 0; fi; \
		sleep 0.1; \
	done; \
	pids="$$(lsof -tiTCP:$(DEV_PORT) -sTCP:LISTEN 2>/dev/null || true)"; \
	if [[ -n "$$pids" ]]; then kill -KILL $$pids 2>/dev/null || true; fi; \
	for _ in $$(seq 1 20); do \
		if ! lsof -tiTCP:$(DEV_PORT) -sTCP:LISTEN >/dev/null 2>&1; then exit 0; fi; \
		sleep 0.1; \
	done; \
	echo "Port $(DEV_PORT) is still occupied." >&2; \
	exit 1

dev-restart: dev-stop
	@$(MAKE) dev

browser-test: build
	bun run browser:test

browser-install:
	bun run browser:install
