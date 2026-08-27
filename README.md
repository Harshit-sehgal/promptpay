# Ateva

Privacy-first beta for independently verifiable AI wait time and developer attention.

The beta validates wait-state detection without awarding rewards. Settlement stays fail-closed until an independently verifiable attestation integration is deployed and reviewed; advertisers are not billed for beta waits.

## Architecture

This monorepo (pnpm workspaces + Turborepo) contains:

| Package                  | Description                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| `apps/api`               | NestJS REST API — auth, campaigns, ledger, payouts, fraud detection, extensions |
| `apps/web`               | Next.js frontend — developer, advertiser, and admin dashboards                  |
| `apps/cli`               | CLI tool — register device, report wait states, check earnings                  |
| `apps/vscode-extension`  | VS Code extension — detects wait states, displays sponsored ads                 |
| `packages/shared`        | Shared types, Zod contracts, HMAC signing, constants                            |
| `packages/config`        | Zod-validated environment schema shared by all apps                             |
| `packages/db`            | Prisma schema, migrations, and client re-exports                                |
| `packages/ui`            | Shared UI components                                                            |
| `packages/eslint-config` | Shared ESLint flat config                                                       |

## Quickstart

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Generate Prisma client
pnpm --filter @ateva/db generate

# Start database and Redis-backed local rate limiting
docker compose up -d postgres redis

# Start API dev server
pnpm --filter ateva-api dev

# Start web dev server (in another terminal)
pnpm --filter ateva-web dev
```

The API serves interactive **OpenAPI docs at `/api/v1/docs`** (spec:
`/api/v1/docs-json`) once the API is running.

## Make targets

A `Makefile` wraps common workflows: `make dev`, `make build`, `make typecheck`,
`make lint`, `make test`, `make db-migrate`, `make db-studio`. Run `make help`.

## Quality Gates

```bash
pnpm run typecheck   # all workspace packages (config, ui, shared, db, api, cli, vscode, web)
pnpm run lint        # ESLint across all workspaces (style warnings allowed)
pnpm run build        # all workspace packages via Turborepo
pnpm run test        # full suite (API unit/contract/e2e-http + CLI + web + VS Code)
                      # DB-backed API specs require DATABASE_URL + JWT_SECRET (>=32 chars)
pnpm audit --prod    # production dependency vulnerability audit
```

> **Note:** Tests that touch the database require Postgres and Redis running locally.
> Start them with `docker compose up -d postgres redis` and ensure `DATABASE_URL`,
> `JWT_SECRET` (≥32 chars), and other required env vars are set via `.env` or
> the shell. See [Environment Reference](docs/ENV_REFERENCE.md) for the full list.

## Private beta wait telemetry

Use `ateva run -- <AI command> [arguments...]` to let the CLI supervise a
real local AI-tool process lifecycle, for example `ateva run -- claude
--version`. It sends only a normalized tool type and lifecycle timing—never the
command arguments, prompt, or command output.

This is pilot telemetry, not settlement proof. The current device-held signing
key cannot independently prove an unmodified client observed a wait, so these
events remain non-billable and rewards are disabled until an independently
attestable integration is deployed and reviewed.

## Core Features

- **Auth**: Email/password signup, Google OAuth, JWT refresh rotation + reuse detection, password reset, TOTP 2FA with encrypted secrets
- **Campaigns**: Draft → submitted → approved → active lifecycle with budget/bid validation
- **Ledger**: Three-ledger accounting (earnings, advertiser, platform) with 60/30/10 revenue split
- **Payouts**: Multi-provider architecture with PayPal Payouts, Stripe Connect, and Wise wired, Razorpay/Payoneer/Dodo stubs fail-closed in production, hold periods by trust level, optional 2FA gating
- **Fraud**: Redis-backed rate limits, brute-force lockouts, CTR analysis, self-click detection, trust scoring, automatic earning holds
- **Extensions**: HMAC-signed event pipeline per device, privacy-enforced, idempotent, with password/Google/support device-secret recovery
- **Referrals**: Code-based referral system with $5 reward on first payout
- **Compliance**: Consent ledger, data-retention cron, and admin/user erasure paths that revoke sessions and API keys
- **API Keys**: Machine-to-machine auth with scoped, expirable keys

### Runtime state of the money features

The features above are **implemented and tested**, not **switched on**. Every
money path is behind a runtime setting that fails closed when its row is absent,
so a fresh database starts fully disabled (`runtime-config.service.ts`):

| Switch             | Default | Gates                                                    |
| ------------------ | ------- | -------------------------------------------------------- |
| `ads.global`       | **off** | serving any ad at all                                    |
| `wait.earnings`    | **off** | settlement; also requires an external attestation issuer |
| `deposits.global`  | **off** | advertiser funding                                       |
| `payouts.requests` | **off** | developer payout requests                                |
| `payouts.auto`     | **off** | automated payout processing                              |

Only an `admin`/`super_admin` can flip them. Payout rails: `paypal_email` and
`manual` are available (both admin-processed by hand); PayPal Payouts, Stripe
Connect and Wise are complete but credential-gated; Payoneer, Razorpay and Dodo
Payments are stubs that are refused at registration.

**Launch readiness:** use the live residual register in [`AGENTS.md`](AGENTS.md)
and its linked GitHub issues. `LAUNCH_PLAN.md` and the A-087…A-090 audit entries
are historical records, not current release status.

## Documentation

Start with [`AGENTS.md`](AGENTS.md) — it is the authoritative repo-wide audit
and the live residual register. Everything below is reference material.

### Product & design

- [Strategy Audit](docs/00-strategy-audit.md)
- [Product Requirements](docs/01-product-requirements.md)
- [MVP Roadmap](docs/05-mvp-roadmap.md)
- [Payout Strategy](docs/07-payout-strategy.md)
- [Advertiser Economics](docs/ADVERTISER_ECONOMICS.md)
- [UI Page List](docs/09-ui-page-list.md)
- [Validation Experiments](docs/14-validation-experiments.md)
- [Sources & Assumptions](docs/15-sources-and-assumptions.md)

### Architecture & API

- [Technical Architecture](docs/02-technical-architecture.md)
- [Architecture Overview](docs/16-architecture-overview.md)
- [Implementation Blueprint](docs/ateva-implementation-blueprint.md)
- [Database Schema](docs/03-database-schema.md) · [ER Diagram](docs/er-diagram.md)
- [API Specification](docs/04-api-specification.md) · [API Changelog](docs/17-api-changelog.md)
- [Rate Limiting](docs/rate-limiting.md)

### Architecture Decision Records

- [0001 — Record architecture decisions](docs/adr/0001-record-architecture-decisions.md)
- [0002 — Three-ledger accounting](docs/adr/0002-three-ledger-accounting.md)
- [0003 — Extension event pipeline](docs/adr/0003-extension-event-pipeline.md)
- [0004 — JWT rotation & TOTP 2FA](docs/adr/0004-jwt-rotation-totp-2fa.md)
- [0005 — Swagger plugin](docs/adr/0005-swagger-plugin.md)
- [0006 — Fail-closed payouts](docs/adr/0006-fail-closed-payouts.md)
- [0007 — Independent wait attestation](docs/adr/0007-independent-wait-attestation.md)

### Trust, fraud & compliance

- [Fraud Prevention Plan](docs/06-fraud-prevention-plan.md)
- [Compliance & Privacy Checklist](docs/08-compliance-privacy-checklist.md)
- [Risk Register](docs/13-risk-register.md)
- [Security Audit Checklist](docs/security-audit-checklist-2026-07-12.md)
- [Legal documents](docs/legal/README.md)
- Wait attestation: [Launch Gate](docs/ops/wait-attestation-launch-gate.md) ·
  [Protocol](docs/ops/wait-attestation-protocol.md) ·
  [Threat Model](docs/ops/wait-attestation-threat-model.md)

### Operations

- [Operational Runbooks](docs/ops/runbooks.md) ·
  [Backup & Retention](docs/16-operational-runbooks.md)
- Deploy: [Quick-start](docs/ops/deployment.md) ·
  [Checklist](docs/ops/deployment-checklist.md) ·
  [Full runbook](docs/ops/rollback-and-deployment.md) ·
  [OCI API host](docs/ops/oci-api-deployment.md)
- Rollback: [Procedure](docs/ops/rollback.md) ·
  [Database migrations](docs/ops/migration-rollback.md)
- Recovery: [Backup & Restore](docs/ops/backup-restore-runbook.md) ·
  [Disaster Recovery](docs/ops/disaster-recovery-runbook.md)
- Money: [Payouts](docs/ops/payout-runbook.md) ·
  [Ledger Reconciliation](docs/ops/ledger-reconciliation-runbook.md) ·
  [Dodo review access](docs/ops/dodo-review-access.md)
- Review queues: [Fraud](docs/ops/fraud-review-runbook.md) ·
  [Campaign approval](docs/ops/campaign-approval-runbook.md)
- [Incident Response](docs/ops/incident-response.md) ·
  [Monitoring](docs/ops/monitoring.md) ·
  [Audit Outbox](docs/ops/audit-outbox.md)
- [Client Release](docs/ops/client-release.md) ·
  [Branch Protection](docs/ops/branch-protection.md)
- [Public Exposure Audit](docs/ops/public-exposure-audit.md) ·
  [Remaining Open Items](docs/ops/remaining-open-items.md)
- [Environment Reference](docs/ENV_REFERENCE.md)

### Contributing

- [Onboarding](docs/ONBOARDING.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Style Guide](docs/STYLE_GUIDE.md)
- [Code Review Checklist](docs/CODE_REVIEW_CHECKLIST.md)
- [Definition of Done](docs/12-definition-of-done.md)
- [Engineering Breakdown](docs/10-engineering-task-breakdown.md) ·
  [Milestone Checklist](docs/11-milestone-checklist.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

### Historical records — do not plan against these

- [Launch Plan](LAUNCH_PLAN.md) — superseded 2026-08-18; a launch-readiness
  audit and phasing record
- [Foundation Status](FOUNDATION_STATUS.md) — superseded 2026-08-07; a record of
  the July hardening pass
- [Dodo Payments Plan](DODO_PAYMENTS_PLAN.md) — the payment-rail workstream plan
