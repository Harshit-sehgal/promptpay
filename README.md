# WaitLayer

Privacy-first reward marketplace for AI wait time and developer attention.

Developers earn rewards by viewing sponsored content during AI tool wait states (compilation, analysis, code generation). Advertisers bid for attention in a fraud-mitigated, ledger-backed marketplace.

## Architecture

This monorepo (pnpm workspaces + Turborepo) contains:

| Package | Description |
|---------|-------------|
| `apps/api` | NestJS REST API — auth, campaigns, ledger, payouts, fraud detection, extensions |
| `apps/web` | Next.js frontend — developer, advertiser, and admin dashboards |
| `apps/cli` | CLI tool — register device, report wait states, check earnings |
| `apps/vscode-extension` | VS Code extension — detects wait states, displays sponsored ads |
| `packages/shared` | Shared types, Zod contracts, HMAC signing, constants |
| `packages/config` | Zod-validated environment schema shared by all apps |
| `packages/db` | Prisma schema, migrations, and client re-exports |
| `packages/ui` | Shared UI components |
| `packages/eslint-config` | Shared ESLint flat config |

## Quickstart

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Generate Prisma client
pnpm --filter @waitlayer/db generate

# Start database and Redis-backed local rate limiting
docker compose up -d postgres redis

# Start API dev server
pnpm --filter waitlayer-api dev

# Start web dev server (in another terminal)
pnpm --filter waitlayer-web dev
```

The API serves interactive **OpenAPI docs at `/api/v1/docs`** (spec:
`/api/v1/docs-json`) once the API is running.

## Make targets

A `Makefile` wraps common workflows: `make dev`, `make build`, `make typecheck`,
`make lint`, `make test`, `make db-migrate`, `make db-studio`. Run `make help`.

## Quality Gates

```bash
pnpm run typecheck   # all 9 packages (config, ui, shared, db, api, cli, vscode, web)
pnpm run lint        # ESLint across all workspaces (style warnings allowed)
pnpm run build       # all 9 packages via Turborepo
pnpm run test        # full suite (API unit/contract/e2e-http + CLI + web + VS Code)
                      # DB-backed API specs require DATABASE_URL + JWT_SECRET (>=32 chars)
pnpm audit --prod    # production dependency vulnerability audit
```

> **Note:** Tests that touch the database require Postgres and Redis running locally.
> Start them with `docker compose up -d postgres redis` and ensure `DATABASE_URL`,
> `JWT_SECRET` (≥32 chars), and other required env vars are set via `.env` or
> the shell. See [Environment Reference](docs/ENV_REFERENCE.md) for the full list.

## Core Features

- **Auth**: Email/password signup, Google OAuth, JWT refresh rotation + reuse detection, password reset, TOTP 2FA with encrypted secrets
- **Campaigns**: Draft → submitted → approved → active lifecycle with budget/bid validation
- **Ledger**: Three-ledger accounting (earnings, advertiser, platform) with 60/30/10 revenue split
- **Payouts**: Multi-provider architecture with PayPal Payouts, Stripe Connect, and Wise wired, Razorpay/Payoneer stubs fail-closed in production, hold periods by trust level, optional 2FA gating
- **Fraud**: Redis-backed rate limits, brute-force lockouts, CTR analysis, self-click detection, trust scoring, automatic earning holds
- **Extensions**: HMAC-signed event pipeline per device, privacy-enforced, idempotent, with password/Google/support device-secret recovery
- **Referrals**: Code-based referral system with $5 reward on first payout
- **Compliance**: Consent ledger, data-retention cron, and admin/user erasure paths that revoke sessions and API keys
- **API Keys**: Machine-to-machine auth with scoped, expirable keys

## Documentation

- [Strategy Audit](docs/00-strategy-audit.md)
- [Product Requirements](docs/01-product-requirements.md)
- [Technical Architecture](docs/02-technical-architecture.md)
- [Database Schema](docs/03-database-schema.md)
- [API Specification](docs/04-api-specification.md)
- [MVP Roadmap](docs/05-mvp-roadmap.md)
- [Fraud Prevention Plan](docs/06-fraud-prevention-plan.md)
- [Payout Strategy](docs/07-payout-strategy.md)
- [Compliance & Privacy](docs/08-compliance-privacy-checklist.md)
- [UI Page List](docs/09-ui-page-list.md)
- [Engineering Breakdown](docs/10-engineering-task-breakdown.md)
- [Milestone Checklist](docs/11-milestone-checklist.md)
- [Definition of Done](docs/12-definition-of-done.md)
- [Risk Register](docs/13-risk-register.md)
- [Validation Experiments](docs/14-validation-experiments.md)
- [Sources & Assumptions](docs/15-sources-and-assumptions.md)
- [Architecture Overview](docs/16-architecture-overview.md)
- [API Changelog](docs/17-api-changelog.md)
- [Architecture Decision Records](docs/adr/0001-record-architecture-decisions.md)
- [Foundation Status](FOUNDATION_STATUS.md)
