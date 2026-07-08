# WaitLayer Makefile — common developer shortcuts
#
# Usage: make <target>
# Most targets defer to pnpm workspace filters.

.PHONY: install dev build typecheck lint test db-generate db-migrate \
        db-studio start-api start-web clean help

help: ## Show this help
	@echo "WaitLayer — available make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install workspace dependencies
	pnpm install --frozen-lockfile

dev: ## Run all apps in dev mode (API + Web)
	pnpm run dev

build: ## Build all packages
	pnpm run build

typecheck: ## Typecheck all packages
	pnpm run typecheck

lint: ## Lint all packages
	pnpm run lint

test: ## Run all tests (requires DATABASE_URL + REDIS_URL + JWT_SECRET)
	pnpm run test

db-generate: ## Regenerate the Prisma client
	pnpm --filter @waitlayer/db generate

db-migrate: ## Apply Prisma migrations (dev)
	pnpm --filter @waitlayer/db migrate

db-studio: ## Open Prisma Studio
	pnpm --filter @waitlayer/db studio

start-api: ## Build + start the API
	pnpm run start:api

start-web: ## Build + start the Web app
	pnpm run start:web

clean: ## Remove build output
	rm -rf dist apps/*/dist packages/*/dist
