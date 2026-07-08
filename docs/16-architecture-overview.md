# WaitLayer — Architecture Overview

> Last updated: 2026-07-08

WaitLayer is a **privacy-first reward marketplace** for AI wait time and
developer attention. Developers earn money by viewing sponsored content during
AI tool wait states (compilation, analysis, code generation). Advertisers bid
for that attention in a fraud-mitigated, ledger-backed marketplace.

This document is the entry point for understanding how the system fits together.
It pairs with the [ADRs](./adr/0001-record-architecture-decisions.md) and the
[API Specification](./04-api-specification.md).

---

## System Context

```
                         ┌─────────────────────────────────────────────┐
                         │                Developers                    │
                         │  (VS Code ext · CLI · Web dashboard)         │
                         └───────────────┬───────────────┬─────────────┘
                                         │ wait-state +   │ register / ad
                                         │ ad events      │ request
                                         ▼               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           WaitLayer API  (NestJS)                           │
│                                                                            │
│  ┌────────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌──────────────┐   │
│  │  Auth /    │  │ Campaign │  │ Ledger │  │ Payout │  │  Fraud /     │   │
│  │  2FA       │─▶│ /Creative│─▶│(3 books)│─▶│(PSPs)  │  │  Trust       │   │
│  └────────────┘  └──────────┘  └───┬────┘  └───┬────┘  └──────────────┘   │
│                                     │             │                       │
│                          ┌──────────┴─────────────┴──────────┐            │
│                          │      Advertiser / Extensions      │            │
│                          │      Admin / Compliance / Referral│            │
│                          └────────────────────────────────────┘           │
└───────────────┬───────────────────────┬──────────────────────┬──────────┘
                │                       │                      │
                ▼                       ▼                      ▼
        ┌──────────────┐        ┌──────────────┐      ┌──────────────────┐
        │  PostgreSQL  │        │    Redis     │      │  PSPs (Stripe,   │
        │  (source of  │        │ (rate limit, │      │  PayPal, Wise,   │
        │   truth)     │        │  brute-force,│      │  manual)         │
        └──────────────┘        │  throttling) │      └──────────────────┘
                                └──────────────┘

        ┌──────────────────────────────────────────────────────────────┐
        │  Web (Next.js) — developer / advertiser / admin / legal UIs   │
        │  Same-origin Route Handler proxy → API (cookie + bearer auth) │
        └──────────────────────────────────────────────────────────────┘
```

---

## Core Flows

### 1. Earn (developer attention → money)

1. **Extension/CLI** detects a wait state → `POST /extension/wait-state/start`
   (HMAC-signed per-device).
2. `POST /extension/ad-request` serves a privacy-screened ad (only after an
   active wait state).
3. `POST /extension/ad-rendered` then `POST /extension/impression-qualified`
   (visible ≥ 5000ms) bills the advertiser and credits the developer.
4. CPC campaigns bill on `POST /extension/click` instead of on impression.
5. `LedgerCronService` matures `estimated → confirmed` earnings after the
   trust-level hold period.

### 2. Spend (advertiser → campaign)

1. Advertiser creates a campaign (draft) with budget + bid + category.
2. Adds creatives → submits → admin approves creative(s) + campaign → `active`.
3. Each qualified impression/click debits the **advertiser ledger** and credits
   the **earnings ledger** + **platform ledger** (60/30/10 split).

### 3. Payout (developer → bank)

1. Developer adds a payout method (PayPal / Stripe Connect / Wise / manual).
2. Requests payout (≥ $10, no fraud holds, optional 2FA gate).
3. Admin approves → provider initiates → `PayoutCronService` polls to `paid`.
4. First paid payout triggers the referrer's $5 reward.

---

## Key Design Decisions

| Area | Decision | Why |
|------|----------|-----|
| Money | **Three-ledger double-entry** (earnings / advertiser / platform) | Auditable, fraud-resistant, supports holds & recovery debits |
| Split | **60/30/10** (80/10/10 launch) developer/platform-fee/fraud-reserve | Aligns incentives, funds the fraud reserve |
| Extensions | **HMAC-signed, idempotent events** with per-device secrets | Privacy-enforced, replay-safe, no shared global key |
| Auth | JWT access + refresh with **rotation + reuse detection**, TOTP 2FA | Detects token theft; phishing-resistant second factor |
| Anti-fraud | Redis-backed rate limits, brute-force lockouts, CTR & self-click analysis, trust scoring | Stops incentive fraud before it pays out |
| Payouts | Multi-provider with **fail-closed** production guards | Never moves real money without configured, ready providers |
| Privacy | Consent ledger, retention cron, erasure paths | GDPR/CCPA-aligned data lifecycle |

See [ADRs](./adr/0001-record-architecture-decisions.md) for the rationale and
alternatives considered for each.

---

## Package Map

| Package | Responsibility |
|---------|----------------|
| `apps/api` | NestJS REST API — all domains |
| `apps/web` | Next.js dashboards (developer / advertiser / admin / legal) |
| `apps/cli` | Developer CLI — register device, report wait states, check earnings |
| `apps/vscode-extension` | VS Code extension — wait-state detection + ad panel |
| `packages/shared` | Types, Zod contracts, HMAC signing, constants |
| `packages/config` | Zod-validated environment schema |
| `packages/db` | Prisma schema, migrations, client |
| `packages/ui` | Shared UI components |
| `packages/eslint-config` | Shared ESLint flat config |

---

## Observability

- **Health**: `GET /health` (DB + Redis), `GET /health/metrics` (admin JWT).
- **Logging**: structured JSON in production (`type`, `method`, `url`,
  `statusCode`, `durationMs`, `requestId`); human-readable in dev.
- **Tracing**: Sentry (API + Web) with source maps in CI.
- **Correlation**: every request carries an `x-request-id` echoed in logs and
  error responses.
- **API docs**: Swagger UI at `/api/v1/docs`, OpenAPI contract generated from
  controllers + DTOs via the NestJS Swagger compiler plugin.
