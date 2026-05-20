# Reputo — top-level developer commands.
#
# Run `make help` for a list. The Makefile is the canonical entry point for
# every stack operation; pnpm scripts handle code-only concerns.

# ----- Config --------------------------------------------------------------

SHELL          := bash
.SHELLFLAGS    := -eu -o pipefail -c
.DEFAULT_GOAL  := help
.ONESHELL:

DOCKER         ?= docker
COMPOSE        ?= $(DOCKER) compose
DC_DEV         := $(COMPOSE) -f docker/compose/dev.yml
DC_SELFHOST    := $(COMPOSE) --env-file docker/env/prod.env \
                  -f docker/compose/infra.yml \
                  -f docker/compose/observability.yml \
                  -f docker/compose/apps.yml

# Services in the dev stack. Override on the command line, e.g.:
#   make logs SVC=api
SVC            ?= api

# ----- Help ----------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make \033[36m<target>\033[0m\n\n"} \
		/^[a-zA-Z0-9_.-]+:.*## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 } \
		/^## / { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) }' $(MAKEFILE_LIST)

## Onboarding

.PHONY: bootstrap
bootstrap: ## Copy env examples, generate secrets, run preflight checks
	@bash scripts/dev/bootstrap.sh

.PHONY: doctor
doctor: ## Verify required tools and versions
	@bash scripts/dev/doctor.sh

## Local stack (Docker)

.PHONY: up
up: ## Bring the full dev stack up (api, ui, workers, mongo, temporal, minio, observability)
	$(DC_DEV) up --build -d

.PHONY: up-fg
up-fg: ## Bring the dev stack up in the foreground (Ctrl-C stops it)
	$(DC_DEV) up --build

.PHONY: down
down: ## Stop the dev stack (preserve volumes)
	$(DC_DEV) down

.PHONY: nuke
nuke: ## Stop the dev stack and DELETE all volumes (irreversible)
	@printf 'This deletes all dev volumes (mongo, postgres, minio, grafana). Proceed? [y/N] '; \
	read -r ans; [ "$$ans" = "y" ] || [ "$$ans" = "Y" ] || exit 1
	$(DC_DEV) down --volumes --remove-orphans

.PHONY: ps
ps: ## Show running dev containers
	$(DC_DEV) ps

.PHONY: logs
logs: ## Tail dev logs for one service (override SVC=, default: api)
	$(DC_DEV) logs -f --tail=200 $(SVC)

.PHONY: logs-all
logs-all: ## Tail dev logs for every service
	$(DC_DEV) logs -f --tail=100

.PHONY: shell
shell: ## Open a shell in a running dev container (override SVC=)
	$(DC_DEV) exec $(SVC) bash || $(DC_DEV) exec $(SVC) sh

.PHONY: minio-init
minio-init: ## Re-run MinIO bucket creation (rarely needed; runs automatically on up)
	$(DC_DEV) run --rm minio-init

## Code workflow

.PHONY: install
install: ## Install workspace dependencies with pnpm
	pnpm install --frozen-lockfile

.PHONY: build
build: ## Build every workspace
	pnpm build

.PHONY: check
check: ## Biome lint + format check
	pnpm check

.PHONY: format
format: ## Biome format-write
	pnpm format

.PHONY: test
test: ## Run the Vitest suite
	pnpm test

.PHONY: test-cov
test-cov: ## Run the Vitest suite with coverage
	pnpm test:cov

.PHONY: typecheck
typecheck: ## Type-check every workspace
	pnpm typecheck

.PHONY: clean
clean: ## Remove build artifacts, turbo cache, and node_modules caches (does NOT touch volumes)
	pnpm clean

## Build artifacts (Docker images)

.PHONY: image-api image-ui image-workflows images
image-api: ## Build the api image locally (matches CI)
	pnpm docker:build api
image-ui: ## Build the ui image locally (matches CI)
	pnpm docker:build ui
image-workflows: ## Build the workflows image locally (matches CI)
	pnpm docker:build workflows
images: image-api image-ui image-workflows ## Build all three app images locally

## Self-host (Komodo-free production — see docs/handoff/README.md)

.PHONY: selfhost-config
selfhost-config: ## Render the merged self-host compose to stdout (sanity check)
	$(DC_SELFHOST) config

.PHONY: selfhost-pull
selfhost-pull: ## Pull the images declared in prod.env
	$(DC_SELFHOST) pull

.PHONY: selfhost-up
selfhost-up: ## Deploy or upgrade the self-host stack
	@printf 'Deploying self-host stack with docker/env/prod.env. Proceed? [y/N] '; \
	read -r ans; [ "$$ans" = "y" ] || [ "$$ans" = "Y" ] || exit 1
	$(DC_SELFHOST) up -d

.PHONY: selfhost-down
selfhost-down: ## Stop the self-host stack (preserves volumes)
	$(DC_SELFHOST) down

.PHONY: selfhost-ps
selfhost-ps: ## Show running self-host containers
	$(DC_SELFHOST) ps

.PHONY: selfhost-logs
selfhost-logs: ## Tail self-host logs for one service (override SVC=)
	$(DC_SELFHOST) logs -f --tail=200 $(SVC)
