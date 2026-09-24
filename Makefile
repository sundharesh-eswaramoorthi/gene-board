# Gene Board developer tasks. Run `make` (or `make help`) for the list.
#
# Run make from the repository root. Paths are relative on purpose: the repository path
# may contain spaces, which make cannot quote reliably.

.DEFAULT_GOAL := help

COMPOSE    ?= docker compose
DB_SERVICE := db
DB_USER    := geneboard
DB_NAME    := geneboard
BACKEND    := backend
FRONTEND   := frontend
E2E        := e2e
SERVER_BIN := bin/server# relative to $(BACKEND); ignored by git

.PHONY: help install db-up db-down db-reset db-wipe db-psql migrate seed sqlc backend frontend \
	dev test-backend check-frontend e2e e2e-ui e2e-install build up down demo-reset clean

help: ## Show this help
	@echo "Gene Board make targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' Makefile | awk 'BEGIN {FS = ":.*## "} {printf "  %-14s %s\n", $$1, $$2}'

install: ## Download the Go modules and install the frontend's npm packages
	cd $(BACKEND) && go mod download
	cd $(FRONTEND) && npm install

# --- database ---

db-up: ## Start PostgreSQL (compose service db, host port 5442) and wait until healthy
	$(COMPOSE) up -d --wait --wait-timeout 120 $(DB_SERVICE)

db-down: ## Stop and remove the containers (db, and api/web if running); data is kept
	$(COMPOSE) --profile full down

db-reset: db-wipe ## Drop and recreate the dev database, then apply the migrations
	$(MAKE) migrate

# Drops and recreates the dev database, empty (psql runs in the db container: no Go needed).
db-wipe: db-up
	$(COMPOSE) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d postgres \
		-c 'DROP DATABASE IF EXISTS $(DB_NAME) WITH (FORCE)' \
		-c 'CREATE DATABASE $(DB_NAME) OWNER $(DB_USER)'

db-psql: ## Open psql on the dev database
	$(COMPOSE) exec $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME)

migrate: ## Apply the database migrations to the dev database
	cd $(BACKEND) && go run ./cmd/server migrate

seed: ## Load the demo data (demo@geneboard.dev / password123); no-op when already seeded
	cd $(BACKEND) && go run ./cmd/server seed

sqlc: ## Regenerate backend/internal/db from backend/queries and the migrations
	cd $(BACKEND) && sqlc generate

# --- run ---

# Built and exec'ed (not `go run`) so Ctrl-C reaches the server itself, which shuts down
# gracefully. It listens on 127.0.0.1 only (BIND_HOST): the development JWT secret is public.
backend: ## Run the API on 127.0.0.1:8484 (applies pending migrations first)
	cd $(BACKEND) && go build -o $(SERVER_BIN) ./cmd/server && exec ./$(SERVER_BIN)

frontend: ## Run the Vite dev server on :5173 (proxies /api to 127.0.0.1:8484)
	cd $(FRONTEND) && npm run dev

# The API runs from a freshly built binary (not `go run`) so that the signals sent by the
# trap reach the server process itself. Either process exiting stops the other one.
dev: db-up ## Run the API and the Vite dev server together; Ctrl-C stops both
	cd $(BACKEND) && go build -o $(SERVER_BIN) ./cmd/server
	@trap 'kill $$api $$web 2>/dev/null; wait' INT TERM EXIT; \
	./$(BACKEND)/$(SERVER_BIN) & api=$$!; \
	(cd $(FRONTEND) && exec npm run dev) & web=$$!; \
	while kill -0 $$api 2>/dev/null && kill -0 $$web 2>/dev/null; do sleep 1; done

# --- quality & build ---

test-backend: ## Run the backend tests (needs the db service; packages run one at a time)
	cd $(BACKEND) && go test -p 1 ./...

check-frontend: ## Typecheck and lint the frontend
	cd $(FRONTEND) && npm run typecheck && npm run lint

# The e2e suite starts its own stack: the API on :8491 serving a freshly recreated and seeded
# geneboard_e2e database, and Vite on :5174. It never touches the dev database or servers.
# Needs the db service (make db-up). Extra Playwright flags: make e2e ARGS='--project=e2e -g board'
e2e-install: ## Install the e2e suite's npm packages and Playwright's Chromium (if missing)
	@test -d $(E2E)/node_modules || (cd $(E2E) && npm ci)
	@test -d $(FRONTEND)/node_modules || (cd $(FRONTEND) && npm ci)
	cd $(E2E) && npx playwright install chromium

e2e: db-up e2e-install ## Run the Playwright end-to-end suite (screenshots land in e2e/screenshots)
	cd $(E2E) && npx playwright test $(ARGS)

e2e-ui: db-up e2e-install ## Open the Playwright UI runner for the end-to-end suite
	cd $(E2E) && npx playwright test --ui $(ARGS)

build: ## Build the API binary (backend/bin/server) and the frontend bundle (frontend/dist)
	cd $(BACKEND) && go build -o $(SERVER_BIN) ./cmd/server
	cd $(FRONTEND) && npm run build

# .env (git-ignored) gives the containers a JWT_SECRET of their own, so sign-ins survive
# container restarts. Created once, readable only by you; an existing .env is left alone.
# Written to a temporary file first: a failed write must not leave a truncated .env that
# later runs would take as up to date.
.env:
	@umask 077; secret=$$(openssl rand -hex 32) && [ -n "$$secret" ] && \
		printf '# Local secrets for make up (docker compose). Not committed.\nJWT_SECRET=%s\n' "$$secret" > $@.tmp && \
		mv -f $@.tmp $@ && echo "Created .env with a new JWT_SECRET" || { rm -f $@.tmp; exit 1; }

# Before the app starts, a one-off api container migrates the database and, when it has no
# users yet (a new one), loads the demo data (`seed --if-empty`); a database in use is left
# alone. Everything runs in containers, so `up` and `demo-reset` need only Docker.
up: .env ## Build and start db + api + web containers (app on http://localhost:8485)
	$(COMPOSE) --profile full build
	$(COMPOSE) --profile full run --rm api seed --if-empty
	$(COMPOSE) --profile full up -d --wait --wait-timeout 180

down: ## Stop the api + web containers (db keeps running; data is kept)
	$(COMPOSE) --profile full stop api web

# Stops the containers first so nothing holds connections to the database being dropped;
# `up` then migrates the new, empty database and loads the demo data before serving it.
demo-reset: ## Wipe the dev database, reload the demo data and restart the containers
	$(COMPOSE) --profile full stop api web
	$(MAKE) db-wipe
	$(MAKE) up

clean: ## Remove the backend build output
	rm -rf $(BACKEND)/bin
