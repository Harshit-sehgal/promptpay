# WaitLayer Foundation Status

Last updated: 2026-07-03 (verified after Phase B completion: per-device secrets, zod contracts, security hardening, and Docker build)

---

## Verification Methodology

Each domain below was evaluated by inspecting the **actual source**, not by documentation claims. Status reflects what is **demonstrably working** today, with explicit listing of where work is stubbed, partial, or hidden behind missing configuration.

| # | Domain | Status | Verification |
|---|--------|--------|--------------|
| 1 | Build/monorepo | PASS | `pnpm run build` / `pnpm run typecheck` succeeds; all workspace packages compile |
| 2 | API contract | PASS | **Zod 3.25 schemas** integrated via `contract-tests.spec.ts` verifying live HTTP responses |
| 3 | Auth + roles | PASS | Real Postgres integration covers signup/login/refresh/replay/password-reset |
| 4 | Authorization | PASS | Integration test asserts 403s on cross-tenant access |
| 5 | Campaign lifecycle | PASS | Real DB end-to-end: draft → submitted → approved → active |
| 6 | Ledger/money flow | PASS | Integration asserts CPM and CPC 60/30/10 splits with guarded campaign spend |
| 7 | Payouts | Partial | Lifecycle and partial-allocation splitting tested; PSP providers are still stubs |
| 8 | Frontend | PASS | All pages compile; payload shapes align with DTOs |
| 9 | VS Code extension | PASS | Builds clean; device event secret is persisted and used for event signing |
| 10 | CLI + signing | PASS | Builds clean; all payload/response shapes verified |
| 11 | Tests/readiness | PASS | **168 tests across 8 files** (real HTTP+DB + service-level) |
| 12 | Stripe/webhooks | Partial | Controller + provider wired; needs STRIPE_* env to send/receive |
| 13 | Referral system | PASS | Service + frontend wired; reward emitted on payout |
| 14 | API keys | PASS | Service + guard + developer UI complete |
| 15 | Tool integrations | PASS | Seed + admin toggle endpoints present |
| 16 | Webhook events | PASS | Admin view + Stripe logging present |

No silently-failing domains. Where anything remains partial, it is called out below.

---

## 1. Build/monorepo -- PASS

- `pnpm run build` and `pnpm run typecheck` compile all workspace packages cleanly
- Turborepo with pnpm workspaces, TypeScript project references
- Path aliases configured and resolved: `@waitlayer/config`, `@waitlayer/db`, `@waitlayer/shared`
- `pnpm --filter waitlayer-api build` (i.e. `nest build`) produces `dist/apps/api/src/main.js`

**Notable state:**
- Because `paths` aliases reach outside `src/` (into `packages/*/src`), TypeScript emits compiled output under a virtual `rootDir` (`dist/apps/api/src/...`) rather than `dist/`. The Dockerfile is aligned to this actual output path.
- The API Docker image runs `prisma migrate deploy --schema packages/db/prisma/schema.prisma` before starting Nest, so `docker compose up -d` applies pending migrations on startup.

---

## 2. API contract -- PASS

- REST API at `/api/v1/` (set as global prefix in `main.ts`)
- All extension, admin, advertiser, auth, campaign, fraud, ledger, payout, referral, api-keys, tool, and webhook endpoints implemented
- DTO validation via NestJS `ValidationPipe` (whitelist + transform + `forbidNonWhitelisted: true`)
- **Contract Validation:** 14+ Zod schemas in `@waitlayer/shared` (SignupResponse, LoginResponse, etc.) verify that API responses match the expected structural shapes in `contract-tests.spec.ts`
- Shared HMAC signing utility at `packages/shared/src/signing.ts` (canonical JSON, sorted keys → HMAC-SHA256) used by API, CLI, and VS Code extension
- Idempotency keys required on all extension write events

**Verified flow surfaces:**
- Extension routes require HMAC signature over the canonical payload (excluding the `signature` field itself)
- Body schemas strictly reject unknown fields, so misnamed payloads (e.g. `headline` vs `title`) fail with 400
- Device registration issues a per-device `eventSecret`; registered devices with an `eventSecret` must sign events with that secret. The global HMAC fallback remains only for legacy device rows where `eventSecret` is still null.

---

## 3. Auth + roles -- PASS

- Email/password signup, login, refresh (with rotation + reuse detection), logout
- Google OAuth via ID token verification when `GOOGLE_CLIENT_ID` is configured; mock verification available when not set (dev/test only)
- JWT access tokens (`aud: 'access'`, `jti`) and refresh tokens (`aud: 'refresh'`, `jti`, `family`)
- Refresh tokens are looked up by `jti`, the bcrypt hash is verified, and reuse revokes the entire token family
- Role-based guards: `@Roles('admin')`, `@Roles('advertiser')`, `@Roles('developer')`
- Session table tracks `tokenFamily` and `tokenHash` per token
- Password hashing via bcryptjs with salt rounds 12
- Stateless JWT-based email verification flow (`verify-email/request` and `verify-email/confirm`) with automatic trust score recalculation
- Full password reset flow (forgotten $\rightarrow$ token $\rightarrow$ reset $\rightarrow$ session revocation)

**What changed:**
- JwtStrategy strictly verifies `aud === 'access'` and that `jti` is set, so refresh tokens cannot be used to access protected endpoints
- Refresh rotation looks up the session by the refresh token's `jti`, validates the bcrypt hash, and on mismatch or reuse the entire family is revoked

**Known limitations:**
- Production Google OAuth requires a valid `GOOGLE_CLIENT_ID`; without it, only the local mock-token verifier is available

---

## 4. Authorization -- PASS

- Campaign ownership enforced: `advertiserId` must match the caller for create/submit/pause/resume/update/creative-modify
- Device ownership verified before serving ads or recording events
- Wait-state, ad-rendered, impression-qualified, and click events verify signatures against the owning device's event secret
- Ad requests must follow an authenticated user's active wait-state start and are rejected after wait-state end
- Extension idempotency checks run after ownership/signature validation so reused keys cannot bypass authorization
- Payout account ownership verified before requesting payout
- `getMe()` is protected by `JwtAuthGuard` and only returns the requesting user's row
- Admin-only routes use `RolesGuard` with `@Roles('admin', 'super_admin')`

**Verified by integration test:**
- Advertiser B cannot read creative list, cannot update creatives, cannot read campaign stats belonging to Advertiser A (403)
- Developer cannot perform advertiser-only actions (403)

---

## 5. Campaign lifecycle -- PASS

**State machine:** `draft → submitted → approved → active → paused → active → archived`

**Flow:**
1. Advertiser creates campaign (draft) with validated budget, bid, and category
2. Advertiser adds creatives (draft)
3. Advertiser submits campaign → status `submitted`; any draft creatives transition to `pending_review`
4. Admin reviews creatives (approve/reject) — a creative must be `approved` to render in production
5. Admin approves the campaign → status becomes `active` if at least one approved creative exists AND remaining budget > 0, otherwise stays `approved` with a blockers list
6. Advertiser can pause (`active → paused`) and resume (`paused → active`)
7. Category validation blocks prohibited categories; budget min $50, max $1,000,000; bid must be positive

**What changed:**
- `submitCampaign` no longer required any pre-approved creative — it transitions draft creatives to `pending_review`, so the lifecycle is: draft → submit → (admin approves creative) → admin approves campaign → active

---

## 6. Ledger/money flow -- PASS

**Three ledgers:**
- `EarningsLedger` — developer earnings: `estimated → confirmed → paid`
- `AdvertiserLedger` — advertiser charges (debits) and refunds (credits)
- `PlatformLedger` — platform fee + fraud reserve + referral bonus

**Revenue split (60/30/10):**
- 60% to developer (estimated)
- 30% to platform fee (confirmed)
- 10% to fraud/payment reserve (confirmed)
- 80/10/10 for early adopters (`LAUNCH_SPLIT_ENABLED`)

**Hold periods by trust level:**
- `new` / `low_trust`: 30 days
- `normal`: 14 days
- `high_trust`: 7 days

**Money moves on qualified impression (real DB):**
- Single `$transaction`: impression update → advertiser debit (confirmed) → developer credit (estimated) → platform fee (confirmed) → fraud reserve (confirmed) → campaign spend increment
- Idempotency keys prevent double-crediting (`imp-{impressionId}-{bucket}`)
- Impression qualified at minimum 5000ms visible duration
- `LedgerCronService.matureEarnings()` runs on bootstrap and every 10 minutes via `setInterval`; flips `estimated → confirmed` once `availableAt` is in the past

**Money moves on CPC click (real DB):**
- CPC campaign qualification records impression eligibility but creates no ledger rows.
- Valid CPC click creates advertiser debit, developer credit, platform fee, fraud reserve, and campaign spend increment in one transaction.
- `ad_clicks.impressionId` is unique, so one impression cannot be double-click-billed under concurrency.

**Verified by integration test:**
- For a CPM bid of $20.00 and an active campaign, the integration test asserts earningsLedger (1200), advertiserLedger debit (2000), platformLedger platform_fee (600), and platformLedger fraud_reserve (200) all appear after one qualified impression.
- For a CPC bid of $5.00 and an active campaign, the integration test asserts qualification does not bill, then click creates developer credit (300), advertiser debit (500), platform fee (150), and fraud reserve (50), with earnings/platform rows tied to the click id.

---

## 7. Payouts -- Partial

- Multi-provider architecture: PayPal Email, PayPal Payouts, Manual, Wise, Stripe Connect, Razorpay, Payoneer — **all providers are stubbed**: `initiate()` returns a provider-tx-id and `processing` status; none of them contact a real PSP
- Minimum payout threshold: $10.00 (`PAYOUT.MINIMUM_THRESHOLD_MINOR`)
- Fraud flag check (high/critical) blocks payout requests
- Restricted/banned users blocked from payout

**Allocation accounting (verified by tests and source):**
- When a payment allocation is smaller than a ledger entry: the entry is shrunk to the allocated amount and a NEW `confirmed` remainder entry is created with a stable `idempotencyKey`. The `PayoutAllocation.earningsEntryId` references only the shrunken entry.
- `markPayoutPaid` updates only `earningsEntryId ∈ allocatedEntryIds` from `confirmed → paid`. The split remainder stays `confirmed` and remains selectable for a future payout.
- Double-payout prevented by checking that no allocated entry is already `paid` before any update.
- Availability calculations reserve only in-flight payout statuses (`requested`, `under_review`, `approved`, `processing`); already-paid allocations are not subtracted from confirmed availability a second time.

**What changed:**
- A unique constraint on `PayoutAllocation.earningsEntryId` would prevent the same entry being referenced twice; see prisma schema (verify the actual constraint before relying on it for race protection in concurrent payouts).

**Known limitation:**
- Real PSP integration not implemented. To go live, wire `StripeConnectPayoutProvider.initiate()` and `WisePayoutProvider.initiate()` etc. to their respective SDKs, and verify the returned provider `status` (currently always `processing`).

---

## 8. Frontend -- PASS

**Pages across 4 roles:**
- Auth: login, signup
- Developer: dashboard (with referral info), earnings, payouts, settings, trust, api-keys, billing
- Advertiser: dashboard, campaigns, new campaign, billing, reports
- Admin: overview, campaigns, payouts, fraud, users, audit, ledger, api-keys, tools, webhooks
- Legal: privacy, terms, payout-policy, advertiser-policy

**API contracts (verified by source diff):**
- Athletic `createCreative()` sends the BACKEND DTO shape (`title`, `sponsoredMessage`, `destinationUrl`, `displayDomain`), not the legacy `headline/message/ctaText/ctaUrl` shape
- Country targeting sends `[{countryCode, include}]` as a JSON array, matching the backend `setCountryTargeting` payload
- Admin ledger page calls `/ledger/admin/breakdown` and `/ledger/admin/history` (admin-only), with both flat totals **and** nested objects (`earningsLedger`, `advertiserLedger`, `platformLedger`) — backend now returns both shapes for the UI
- `services.ts` exposes `googleLogin`, `refresh`, `getMe`, dashboard APIs, payout APIs, ledger APIs, referral APIs, admin APIs, and api-key APIs

---

## 9. VS Code extension -- PASS

- Full lifecycle wired: register-device → wait-state start → ad-request → ad-rendered → impression-qualified → click → impression-end → wait-state end
- `wait-detector.ts` observes VS Code loading/idle states and emits a `WaitStateEvent` per detection
- `ad-panel.ts` renders the sponsored ad in a webview panel
- `status-bar.ts` shows earnings and ad-serving state
- Uses shared HMAC signing utility (`signPayload`) keyed by the API-issued per-device event secret after registration
- Device registration stores the returned `eventSecret` in VS Code `SecretStorage`; the configured global extension secret is only a fallback before registration or for legacy device rows without `eventSecret`
- Login/logout clear stored device registration state so a new authenticated user re-registers and receives a user-scoped device secret
- Persists access/refresh tokens via `SecretStorage`; refresh interceptor retries once on 401 with a single in-flight refresh
- Ad webview CSP uses per-render nonces for script/style and does not allow `unsafe-inline`
- Advertiser CTA clicks are posted through `acquireVsCodeApi().postMessage()`; the extension host opens only the original validated `http`/`https` URL
- Balance display reads `bal.available.amountMinor / 100` (backend returns `{available: {amountMinor, currency}, pending: {...}, total: {...}, paidOut: {...}}`)

**Verified:**
- All extension routes (`register-device`, `wait-state/start`, `wait-state/end`, `ad-request`, `ad-rendered`, `impression-qualified`, `click`) send payloads that match the backend DTO fields exactly, with a per-device HMAC signature over the canonical payload (without the signature field) where applicable
- Response shapes parsed by the extension match the backend (`{ad: {impressionToken, campaignId, creativeId, title, message, label, displayDomain, destinationUrl}}`)
- `rg "unsafe-inline" apps/vscode-extension/src` returns no matches after the CSP change

---

## 10. CLI + signing -- PASS

**Commands:**
- `auth` — signup/login; stores credentials
- `logout` — clears credentials
- `status` — shows earnings summary and trust score
- `watch` — full wait-state loop: register device → start wait → end wait

**Response/contract alignment (verified by source diff):**
- `login()` parses flat `{user, accessToken, refreshToken}` (NestJS shape), no nested `.data` wrapper
- `getBalance()` parses flat `{available: {amountMinor, currency}, pending: {...}, total: {...}, paidOut: {...}}` — the entry-form shape from the ledger controller
- `getOverview()` parses the full dashboard shape from `/developer/dashboard` (`estimatedEarnings, confirmedEarnings, pendingEarnings, heldEarnings, availableForPayout, lifetimeEarnings, trustLevel, trustScore`)
- `reportWaitState()` normalizes user-supplied tool names through `normalizeToolType()` so values land in the `ToolType` enum (`claude_code`, `codex_cli`, `terminal`, etc.); arbitrary strings fall back to `terminal` instead of being rejected by `forbidNonWhitelisted`
- Error parsing in `raw()` extracts `message` from NestJS exception responses (`{message, error, statusCode}`)

**Verified:**
- CLI builds clean (`pnpm --filter waitlayer-cli build`)
- All DTO fields in extension calls match backend expectations

---

## 11. Tests/readiness -- PASS

**168 tests across 8 files (all pass):**

| File | Tests | Type | Coverage |
|------|-------|------|----------|
| `auth/auth.service.spec.ts` | 27 | Unit | signup, login, refresh, replay detection, verification, password reset |
| `auth/strategies/google-token-verifier.spec.ts` | 3 | Unit | env constraints; mock token verifier |
| `fraud/fraud.service.spec.ts` | 10 | Unit | trust score, rate limit, self-click, flags |
| `ledger/ledger.service.spec.ts` | 18 | Unit | splits, guarded spend, balances, history, hold days |
| `payout/payout.service.spec.ts` | 14 | Unit | allocation validation, partial split, provider routing |
| `integration/e2e-money-loop.spec.ts` | 27 | Service-level E2E | Campaign through payout via mocked Prisma |
| `integration/e2e-http-flow.spec.ts` | 42 | **Real HTTP + Postgres** | Full stack from signup to payout |
| `integration/contract-tests.spec.ts` | 27 | **Contract** | Zod validation of API response shapes |

**What the real HTTP integration test actually exercises (with `JWT_SECRET` and `DATABASE_URL` set):**
- Real NestJS `Test.createTestingModule({imports: [AppModule]})`
- App created with `setGlobalPrefix('api/v1')` and the same `ValidationPipe` as production
- `BruteForceGuard` and `ThrottleByRouteGuard` overridden for speed
- Supertest drives real HTTP against the Nest runtime
- Real Prisma against the developer database (`TRUNCATE ... CASCADE` in `beforeAll` to reset state)
- Phase 1: signup → login → refresh token rotation → token reuse detection (revokes family) → email-checkpoint trust score recompute
- Phase 2: advertiser profile auto-create → campaign (draft) → creative (draft) → country targeting (US, CA) → submit campaign (creative goes `pending_review`) → admin approves creative → admin approves campaign → campaign auto-`active` → cross-tenant 403s enforced
- Phase 3: developer registers device and receives `eventSecret` → wrong device signature is rejected → wait-state start (per-device HMAC-signed) → ad request during active wait state → ad-rendered → CPM qualified impression bills with four ledger rows → CPM click creates no extra charge → CPC qualification creates no ledger rows → CPC click bills with four ledger rows
- Phase 4: `LedgerCronService.matureEarnings()` flips the entry to `confirmed` → developer adds PayPal email method → requests payout for the exact entry → admin approves → admin marks paid → entry transitions to `paid`

**Test infrastructure:**
- Vitest with v8 coverage
- In-memory mocks for service-level tests (`vi` mocks for Prisma, capturing ledger writes for assertions)
- Real Nest runtime + real Postgres for full stack integration

---

## 12. Stripe/webhooks -- Partial

- `StripeProvider` stub: `createDepositSession`, `handleCheckoutComplete`, `verifyWebhookSignature`, `getRefundDetails`, `getDisputeDetails` — methods exist but require `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars to do meaningful work; real network calls are not enabled
- `StripeWebhookController` exists at `POST /payout/stripe/webhook` and `POST /webhooks/stripe`; both are wired through `express.raw()` middleware so Stripe signature verification has access to the raw body
- All incoming events are logged to the `WebhookEvent` table with idempotency via unique `eventId`
- `stripeCustomerId` is wired to the `Advertiser` record on `checkout.session.completed`

**Known limitations:**
- Without `STRIPE_SECRET_KEY`, `createDepositSession` returns a fake checkout URL but won't actually open a session on Stripe's side.
- Without `STRIPE_WEBHOOK_SECRET`, incoming webhook signatures are rejected — the route is reachable but returns 401.

---

## 13. Referral system -- PASS

- Prisma models: `Referral`, `ReferralReward`
- `ReferralService`: `getReferralInfo()`, `applyReferralCode()`, `processReferralRewards()`, `getReferralHistory()`
- Controller routes: `GET /referral`, `POST /referral/apply`, `GET /referral/history`
- Reward: $5 referral bonus credit to referrer's `platformLedger` (`bucket: 'referral_bonus'`) on the referred user's first paid payout
- Triggered automatically from `PayoutService.markPayoutPaid()`
- Frontend: referral code, count, and total rewards shown on the developer dashboard
- Anti-abuse: self-referral blocked; duplicate referral blocked; code format validated

---

## 14. API keys -- PASS

- `ApiKey` model with hashed keys, scopes, expiry
- `ApiKeyService`: `generateApiKey()`, `validateApiKey()`, `revokeApiKey()`
- Controller: `POST /developer/api-keys`, `GET /developer/api-keys`, `DELETE /developer/api-keys/:id`
- `ApiKeyGuard` validates the `X-Api-Key` header for machine-to-machine authentication
- Plaintext key only returned on initial creation; subsequent reads return only the prefix and metadata
- Developer frontend page lists, creates, and revokes keys

---

## 15. Tool integrations -- PASS

- `ToolIntegration` model with seed data for vscode, cli, jetbrains, web (and others as defined in seed)
- Admin endpoints: `GET /admin/tools`, `POST /admin/tools/:slug/toggle`
- Used for tool registry and admin-controlled enable/disable

---

## 16. Webhook events -- PASS

- `WebhookEvent` model logs every incoming Stripe webhook event with provider, eventId, status, and payload
- Admin view: `GET /admin/webhooks` with `provider`, `status`, and pagination filters
- Idempotency via unique `eventId` constraint

---

## Build & Run Commands

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Generate Prisma client (run after schema changes)
pnpm --filter @waitlayer/db generate

# Quality gates
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build

# Run all API tests (requires DATABASE_URL + JWT_SECRET >= 32 chars)
DATABASE_URL="postgresql://waitlayer:waitlayer-dev@localhost:5432/waitlayer" \\
JWT_SECRET="test-jwt-secret-for-integration-test-runs-only-32+" \\
  pnpm --filter waitlayer-api test

# Run with coverage
pnpm --filter waitlayer-api test:cov

# Build and start the Docker stack (PostgreSQL + API + Web)
docker compose build
docker compose up -d

# Develop API locally
pnpm --filter waitlayer-api dev

# Develop Web locally
pnpm --filter waitlayer-web dev
```

---

## Known Limitations (Truthful)

| Limitation | Severity | Detail |
|------------|----------|--------|
| All payout PSP providers are stubs | Med | `StripeConnectPayoutProvider`, `Wise`, `Razorpay`, `Payoneer`, `PayPal Payouts` all return a fake tx id and `processing` — none actually call a real PSP |
| Stripe provider requires env to fully run | Med | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` must be set; without them endpoints stub out |
| Real Google OAuth requires env | Low | `GOOGLE_CLIENT_ID` required for production; offline mock-token verifier is dev/test only |
| Rate limits are per-process, in-memory only | Low | No Redis or distributed limiter; multi-instance deploys would each enforce limits independently |
| No WebSockets / push | Low | Dashboards refresh on user action or polling |
| Dev secrets in `docker-compose.yml` | Med | `JWT_SECRET=change-me-in-production`, `EXTENSION_HMAC_SECRET=dev-secret-change-me-do-not-use-in-production` are placeholders only — must be rotated before production deploy |
| Legacy global HMAC fallback remains for old device rows | Low | Registered devices with `Device.eventSecret` must use per-device signing; fallback is only for legacy rows where `eventSecret` is null. A production rollout should backfill or force re-registration, then remove the fallback entirely |
| Docker Compose has orphan one-off containers locally | Low | `docker compose up -d` warned about old `promptpay-api-run-*` containers from prior manual runs; current named services are healthy |
| Build emits `dist/apps/api/src/main.js` (not `dist/main.js`) | Info | Because path aliases reach outside `src/`, TypeScript's auto-`rootDir` puts output one level deeper. Dockerfile CMD is aligned to the actual path |

---

## Quality Improvements (2026-07-04)

Three rounds of code quality improvements were applied across 16 files (178 insertions, 70 deletions), targeting type safety, maintainability, and developer experience.

### Type Safety

| Change | Files | Impact |
|--------|-------|--------|
| Replaced `(request as any)` with typed `RequestWithOptionalUser` interface | `api-key.guard.ts` | Eliminated 2 lint warnings, improved IDE support |
| Replaced `(err as any)?.code` with proper type-narrowed Prisma error check | `referral.service.ts` | Removed eslint-disable, type-safe error handling |
| Replaced `(globalThis as any)` with typed `Record<string, unknown>` access | `vscode/config.ts` | Type-safe global access |
| Replaced `private api: any` with accurate method-signature interface | `vscode/ad-panel.ts` | Full type checking on API calls |
| `EARNING_TRANSITIONS` typed as `Partial<Record<LedgerStatus, LedgerStatus[]>>` with enum keys | `ledger.service.ts` | Compile-time validation of state transition maps |
| `CAMPAIGN_TRANSITIONS` uses `CampaignStatus` enum values in arrays | `advertiser.service.ts` | Consistent enum usage across transition maps |

### Code Quality & Maintainability

| Change | Files | Impact |
|--------|-------|--------|
| Extracted `DEFAULT_COMPANY_NAME` to `@waitlayer/shared` | `constants.ts`, `auth.service.ts`, `advertiser.service.ts` | Eliminated 3 duplicated `'Unnamed Company'` string literals |
| Refactored module-level `setInterval` into `startCleanup()`/`stopCleanup()` | `brute-force.guard.ts` | Testable interval with cleanup support |
| Injected `ConfigService` instead of reading `process.env.WEB_BASE_URL` | `referral.service.ts` | Proper NestJS DI pattern, validated config |
| Replaced `console.error()` with `Logger.error()` | `audit.service.ts` | Structured NestJS logging |
| Uses validated `loadEnv()` return value instead of raw `process.env` | `main.ts` | Config validated before use |
| Added production guard + dev warning for `EXTENSION_HMAC_SECRET` | `cli/api-client.ts` | Fails fast in production when secret missing; warns in dev |

### Developer Experience & DevOps

| Change | Impact |
|--------|--------|
| Added `.prettierrc` with sensible defaults | Consistent formatting across the project |
| Rewrote `.env.example` with current config keys, `change-me` placeholders, clearer documentation | Faster developer onboarding |
| Replaced hardcoded base64-looking secrets with recognizable dev-only placeholders in `docker-compose.yml` | No ambiguity about production vs dev secrets |
| Added healthcheck and `depends_on: condition: service_healthy` to API + web services | Proper container orchestration in Docker Compose |
| Added `.js` extension to `start:api` script | Consistent with Dockerfile CMD |

### Verification

All quality gates pass cleanly:
- Typecheck: 13/13 tasks — PASS
- Lint: 12/12 tasks, 0 errors, 0 warnings — PASS
- Build: 9/9 packages (full turbo cache) — PASS

---

## Commands Verified This Pass

- `pnpm install --frozen-lockfile` — PASS
- `pnpm --filter @waitlayer/db generate` — PASS
- `pnpm run typecheck` — PASS (13/13 tasks)
- `pnpm run lint` — PASS (12/12 tasks, 0 warnings)
- `pnpm run build` — PASS (9/9 packages, full turbo cache)
- `pnpm --filter waitlayer-api test` — PASS, 168 tests / 8 files
- `docker compose build api` — PASS
- `curl http://localhost:4002/api/v1/auth/me` — PASS smoke check, expected `401 Unauthorized`
- `curl -I http://localhost:3000/` — PASS smoke check, `200 OK`
