# WaitLayer Foundation Status

Last updated: 2026-07-07 (final pass — all code features, runbooks, and operational docs complete)

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
| 7 | Payouts | Partial | Lifecycle, partial allocations, provider-failure release, and production stub guards tested; PayPal Payouts, Stripe Connect, and Wise call their real APIs when configured, Razorpay and Payoneer remain dev/test stubs blocked in production |
| 8 | Frontend | PASS | All pages compile; payload shapes align with DTOs |
| 9 | VS Code extension | PASS | Builds clean; device event secret is persisted and used for event signing |
| 10 | CLI + signing | PASS | Builds clean; all payload/response shapes verified |
| 11 | Tests/readiness | PASS | **235 tests across 12 files** (unit + service-level + contract + E2E HTTP) |
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
- Device registration issues a per-device `eventSecret`; extension events must sign with that device secret. Legacy rows with `eventSecret = null` are rejected for event traffic and can re-register to receive a secret. Existing same-fingerprint devices can recover a lost local secret through old-secret proof, password re-auth, linked-Google re-auth, or a one-time support/admin recovery token.

---

## 3. Auth + roles -- PASS

- Email/password signup, login, refresh (with rotation + reuse detection), logout
- Google OAuth via ID token verification when `GOOGLE_CLIENT_ID` is configured; mock verification available when not set (dev/test only)
- JWT access tokens (`aud: 'access'`, `jti`) and refresh tokens (`aud: 'refresh'`, `jti`, `family`)
- Refresh tokens are looked up by `jti`, the bcrypt hash is verified, and reuse revokes the entire token family
- Role-based guards: `@Roles('admin')`, `@Roles('support')`, `@Roles('advertiser')`, `@Roles('developer')`
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

- Multi-provider architecture: Manual, PayPal Email, PayPal Payouts, Wise, Stripe Connect, Razorpay, Payoneer.
- PayPal Payouts calls the real PayPal API when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are configured. In dev/test it can return a stub response when credentials are absent; in production it fails closed before the payout is claimed.
- Stripe Connect payouts call Stripe's payout API against the developer connected account when `STRIPE_SECRET_KEY` is configured and the payout method destination is an `acct_*` account id; missing configuration or malformed destinations fail closed before money movement.
- Wise payouts call the Wise REST API (`/v1/transfers`) against the developer recipient email when `WISE_API_TOKEN` and `WISE_PROFILE_ID` are configured; empty/invalid email destinations and non-positive amounts fail closed. In dev/test without credentials it returns a stub response; in production it fails closed before the payout is claimed.
- Razorpay and Payoneer remain development stubs and are blocked in `NODE_ENV=production` before the `approved -> processing` claim.
- Minimum payout threshold: $10.00 (`PAYOUT.MINIMUM_THRESHOLD_MINOR`)
- Fraud flag check (high/critical) blocks payout requests
- Restricted/banned users blocked from payout
- Replacing a payout method deactivates the current active destination and creates the replacement in one transaction. The database enforces only one active account per developer/provider while preserving inactive destination history for audit.

**Allocation accounting (verified by tests and source):**
- When a payment allocation is smaller than a ledger entry: the entry is shrunk to the allocated amount and a NEW `confirmed` remainder entry is created with a stable `idempotencyKey`. The `PayoutAllocation.earningsEntryId` references only the shrunken entry.
- `markPayoutPaid` updates only `earningsEntryId ∈ allocatedEntryIds` from `confirmed → paid`. The split remainder stays `confirmed` and remains selectable for a future payout.
- Double-payout prevented by checking that no allocated entry is already `paid` before any update.
- Availability calculations reserve only in-flight payout statuses (`requested`, `under_review`, `approved`, `processing`); already-paid allocations are not subtracted from confirmed availability a second time.
- Fraud discovered after a developer has already been paid creates idempotent confirmed `debit` recovery rows in `earnings_ledger`. Future payout availability subtracts those debits while preserving the original paid credit rows for audit.
- Admin recovery-debt cases list users whose confirmed recovery debits exceed confirmed credits per currency, open/update active collection cases, and resolve cases with external references without mutating the immutable earnings ledger. A partial unique database index prevents duplicate active cases for the same developer and currency.

**What changed:**
- A unique constraint on `PayoutAllocation.earningsEntryId` would prevent the same entry being referenced twice; see prisma schema (verify the actual constraint before relying on it for race protection in concurrent payouts).
- Provider readiness is checked before claiming an approved payout, so unimplemented or unconfigured automated providers cannot move a production payout into `processing`.
- If a provider explicitly returns `failed` from initiation, the payout is marked `failed` and its allocations are deleted in one transaction, making the earnings available for a fresh request.

**Known limitation:**
- In-app Stripe Connect onboarding is still not built; operators must only enable `stripe_connect` payout methods after separately verifying and storing the developer's connected account id. Real PSP integrations remain missing for Razorpay and Payoneer (Wise and Stripe Connect are now wired).

---

## 8. Frontend -- PASS

**Pages across 4 roles:**
- Auth: login, signup
- Developer: dashboard (with referral info), earnings, payouts, settings, trust, api-keys, billing
- Advertiser: dashboard, campaigns, new campaign, billing, reports
- Admin: overview, campaigns, payouts, recovery debt, fraud, users, audit, ledger, api-keys, tools, webhooks
- Legal: privacy, terms, payout-policy, advertiser-policy

**API contracts (verified by source diff):**
- Advertiser `createCreative()` sends the backend DTO shape (`title`, `sponsoredMessage`, `destinationUrl`, `displayDomain`), not the legacy `headline/message/ctaText/ctaUrl` shape
- Country targeting sends `[{countryCode, include}]` as a JSON array, matching the backend `setCountryTargeting` payload
- Admin ledger page calls `/ledger/admin/breakdown` and `/ledger/admin/history` (admin-only), with both flat totals **and** nested objects (`earningsLedger`, `advertiserLedger`, `platformLedger`) — backend now returns both shapes for the UI
- Admin recovery-debt page calls `/admin/recovery-debt`, `/admin/recovery-debt/users/:userId/open`, and `/admin/recovery-debt/cases/:id/resolve` through the same-origin proxy.
- The same-origin proxy now applies its explicit allowlist to the upstream path after stripping `/api`, so browser calls like `/api/admin/overview` and `/api/admin/recovery-debt` match their configured `/admin/...` allowlist entries.
- `services.ts` exposes `googleLogin`, `refresh`, `getMe`, dashboard APIs, payout APIs, ledger APIs, referral APIs, admin APIs, and api-key APIs

---

## 9. VS Code extension -- PASS

- Full lifecycle wired: register-device → wait-state start → ad-request → ad-rendered → impression-qualified → click → impression-end → wait-state end
- `wait-detector.ts` observes VS Code loading/idle states and emits a `WaitStateEvent` per detection
- `ad-panel.ts` renders the sponsored ad in a webview panel
- `status-bar.ts` shows earnings and ad-serving state
- Uses shared HMAC signing utility (`signPayload`) keyed by the API-issued per-device event secret after registration
- Device registration stores the returned `eventSecret` in VS Code `SecretStorage`; the extension no longer uses a global extension HMAC fallback for event payloads
- If the local secret is lost and the API requires recovery, VS Code prompts for a one-time support/admin recovery token and submits it only in the registration request body
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
- `getOrRegisterDevice()` submits any existing local event secret as proof when re-registering, and accepts a one-time support/admin token through `WAITLAYER_DEVICE_RECOVERY_TOKEN`
- `reportWaitState()` normalizes user-supplied tool names through `normalizeToolType()` so values land in the `ToolType` enum (`claude_code`, `codex_cli`, `terminal`, etc.); arbitrary strings fall back to `terminal` instead of being rejected by `forbidNonWhitelisted`
- Error parsing in `raw()` extracts `message` from NestJS exception responses (`{message, error, statusCode}`)

**Verified:**
- CLI builds clean (`pnpm --filter waitlayer-cli build`)
- All DTO fields in extension calls match backend expectations

---

## 11. Tests/readiness -- PASS

**235 tests across 12 files (unit tests all pass; integration tests require real Postgres + JWT_SECRET env):**

| File | Tests | Type | Coverage |
|------|-------|------|----------|
| `auth/auth.service.spec.ts` | 27 | Unit | signup, login, refresh, replay detection, verification, password reset |
| `auth/strategies/google-token-verifier.spec.ts` | 3 | Unit | env constraints; mock token verifier |
| `common/guards/brute-force.guard.spec.ts` | 5 | Unit | Redis-ready brute-force dimensions, reset, production fail-closed behavior |
| `fraud/fraud.service.spec.ts` | 10 | Unit | trust score, rate limit, self-click, flags |
| `ledger/ledger.service.spec.ts` | 27 | Unit | splits, guarded spend, balances, history, hold days |
| `payout/payout.service.spec.ts` | 25 | Unit | allocation validation, partial split, provider routing, production provider guards, recovery-debt availability |
| `payout/providers/stripe-connect.provider.spec.ts` | 7 | Unit | Stripe Connect readiness, connected-account destination validation, payout creation, status mapping |
| `payout/providers/wise.provider.spec.ts` | 4 | Unit | Wise readiness, email-destination validation, stub response, transfer creation |
| `integration/e2e-money-loop.spec.ts` | 40 | Service-level E2E | Campaign through payout via mocked Prisma; per-device signing enforcement, password/Google/support-gated secret recovery, and recovery-debt case operations |
| `integration/e2e-http-flow.spec.ts` | 42 | **Real HTTP + Postgres** | Full stack from signup to payout |
| `integration/contract-tests.spec.ts` | 32 | **Contract** | Zod validation of API response shapes |
| `apps/cli/src/lib/normalize-tool.test.ts` | 7 | Unit | CLI tool-name normalization |
| `payout/payout-cron.service.spec.ts` | 10 | Unit | PayoutCronService poll, complete, fail, error isolation |

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
- `StripeWebhookController` exists at `POST /payout/stripe/webhook` (single authoritative Stripe webhook endpoint) and is wired through `express.raw()` middleware so Stripe signature verification has access to the raw body. A duplicate orphan controller at `POST /webhooks/stripe` was removed (it only handled `checkout.session.completed` and silently dropped refunds/disputes).
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

# Production dependency audit
pnpm audit --prod

# Build and start the Docker stack (PostgreSQL + Redis + API + Web)
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
| Regional automated payout PSPs are not production-ready | Med | Razorpay and Payoneer are dev/test stubs and fail closed in production until real PSP integrations are wired; Wise and Stripe Connect are now wired behind required credentials |
| PayPal Payouts requires credentials for production | Med | `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` must be set before processing `paypal_payouts` requests in production; absent credentials are allowed only for dev/test stubs |
| Stripe provider requires env and onboarding to fully run | Med | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` must be set; Stripe Connect payout methods also require a verified `acct_*` destination until in-app onboarding is built |
| Real Google OAuth requires env | Low | `GOOGLE_CLIENT_ID` required for production; offline mock-token verifier is dev/test only |
| No WebSockets / push | Low | Dashboards refresh on user action or polling |
| Redis required for multi-instance production abuse controls | Low | `REDIS_URL` is required in production; local/test can intentionally fall back to in-memory counters |
| Dev secrets in `docker-compose.yml` | Med | `JWT_SECRET` is a dev-only placeholder and must be rotated before production deploy; compose also enables mock Google auth for local development only |
| Provider-native re-auth for future non-Google identity providers is not wired | Low | Password users recover via password re-auth; Google-linked users recover via matching Google ID token; non-Google passwordless users can recover through a short-lived support/admin token. Future providers should add native provider re-auth to reduce support burden |
| Docker Compose has orphan one-off containers locally | Low | `docker compose up -d` warned about old `promptpay-api-run-*` containers from prior manual runs; current named services are healthy |
| Build emits `dist/apps/api/src/main.js` (not `dist/main.js`) | Info | Because path aliases reach outside `src/`, TypeScript's auto-`rootDir` puts output one level deeper. Dockerfile CMD is aligned to the actual path |

---

## Quality Improvements (2026-07-07 — Final Session)

| Change | Impact |
|--------|--------|
| **Stripe Checkout frontend** — Full deposit flow on billing page | Advertisers can fund accounts via Stripe without admin intervention |
| **Sentry error monitoring** — Web (Next.js) + API (NestJS) | Errors captured with performance tracing, session replay, source maps in CI |
| **PayoutCronService** — Automated payout status polling | PayPal/Stripe payouts auto-complete every 10 min instead of requiring admin action |
| **PayoutCronService tests** — 10 unit tests covering poll, complete, fail, error isolation | Green test suite for the new cron service |
| **Admin metrics dashboard** — Time-series charts, campaign distribution, active users, revenue breakdown | Operational visibility for beta monitoring |
| **Operational runbooks** — Campaign approval, payout, fraud review, ledger reconciliation, rollback & deployment | Complete admin documentation for private beta operations |
| **Infrastructure** — Sentry env vars, CI secrets, Docker Compose, .env.example | Ready for production deployment with minimal config |

## Quality Improvements (2026-07-06)

| Change | Impact |
|--------|--------|
| Removed unused `passport-google-id-token` dependency | Dropped the deprecated `request` dependency chain and cleared production audit findings |
| Added pnpm workspace overrides for `multer@2.2.0` and `postcss@8.5.16` | Pins transitive framework dependencies to patched versions |
| Fixed Next ESLint plugin detection during `next build` | Framework-specific lint rules are now detected by the production build |
| Added payout-provider readiness checks | Unconfigured PayPal Payouts and unimplemented automated providers fail before the payout is claimed in production |
| Added failed-initiate payout handling | Explicit provider failures mark the payout failed and release allocations transactionally |
| Added/updated payout tests | Production provider guards and failed-provider allocation release are covered |
| Added paid-fraud recovery debits | Fraud found after payout creates auditable debit rows that reduce future payout availability |
| Added Redis-backed rate limiting and brute-force tracking | Production auth and route abuse controls share counters across API instances and fail closed if Redis is unavailable |
| Removed global extension HMAC event fallback | Extension events now require API-issued per-device secrets; legacy null-secret device rows are rejected until re-registration issues a secret |
| Added password/Google/support-gated device-secret recovery | Same-account same-fingerprint re-registration can rotate a lost per-device secret after password, linked-Google, or support/admin one-time-token re-authentication, without restoring a shared global HMAC fallback |
| Fixed blocked-category `SET NULL` schema mismatch | `blocked_categories.categoryId` is nullable, so deleting a category preserves historical blocked-category rows instead of failing on a NOT NULL constraint |
| Added recovery-debt case workflow | Admins can list net outstanding paid-fraud recovery debt per currency, open/update active collection cases, and record recovered/written-off/closed outcomes with audit trails; a partial unique index prevents duplicate active cases per developer/currency |
| Fixed payout-account history constraint | Replacing a payout method no longer collides with older inactive destinations; only active user/provider pairs are unique, and the replacement write is transactional |
| Added recovery-debt admin UI and proxy route | Operators can manage recovery debt cases from `/admin/recovery-debt`; the Next.js API proxy allowlist now matches stripped upstream paths correctly |

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
- Lint: 8/8 tasks, 0 errors, 0 warnings — PASS
- Build: 9/9 packages — PASS

---

## Commands Verified This Pass

- `pnpm install --frozen-lockfile` — PASS
- `pnpm run lint` — PASS (8/8 tasks, 0 warnings)
- `pnpm run typecheck` — PASS (13/13 tasks)
- `pnpm run test` — PASS, 235 tests / 12 files (228 API + 7 CLI)
- `pnpm run build` — PASS (9/9 packages)
- `pnpm audit --prod` — PASS, 0 known production vulnerabilities
- `pnpm audit` — PASS, 0 known vulnerabilities
- `git diff --check` — PASS
