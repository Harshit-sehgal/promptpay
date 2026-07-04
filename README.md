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

# Start database
docker compose up -d postgres

# Start API dev server
pnpm --filter waitlayer-api dev

# Start web dev server (in another terminal)
pnpm --filter waitlayer-web dev
```

## Quality Gates

```bash
pnpm run typecheck   # 13/13 tasks
pnpm run lint        # 12/12 tasks, 0 warnings
pnpm run build       # 9/9 packages
pnpm run test        # 168 tests (requires running database)
```

## Core Features

- **Auth**: Email/password signup, Google OAuth, JWT with refresh rotation + reuse detection, password reset
- **Campaigns**: Draft → submitted → approved → active lifecycle with budget/bid validation
- **Ledger**: Three-ledger accounting (earnings, advertiser, platform) with 60/30/10 revenue split
- **Payouts**: Multi-provider architecture (PayPal, Stripe, Wise, Razorpay) with hold periods by trust level
- **Fraud**: Rate limits, CTR analysis, self-click detection, trust scoring, automatic earning holds
- **Extensions**: HMAC-signed event pipeline per device, privacy-enforced, idempotent
- **Referrals**: Code-based referral system with $5 reward on first payout
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
- [Foundation Status](FOUNDATION_STATUS.md)
