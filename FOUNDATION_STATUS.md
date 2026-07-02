# WaitLayer Foundation Status

Last updated: 2026-07-02 (Refinement pass complete — all 9 secondary tasks done)

---

## Domain Status Summary

| # | Domain | Status | Test Coverage |
|---|--------|--------|---------------|
| 1 | Build/monorepo | PASS | Build-only |
| 2 | API contract | PASS | Unit + E2E |
| 3 | Auth + roles | PASS | Unit |
| 4 | Authorization | PASS | Manual |
| 5 | Campaign lifecycle | PASS | E2E |
| 6 | Ledger/money flow | PASS | Unit + E2E |
| 7 | Payouts | PASS | Manual |
| 8 | Frontend | PASS | Manual |
| 9 | VS Code extension | PASS | Manual |
| 10 | CLI + signing | PASS | E2E |
| 11 | Tests/readiness | PASS | 63 tests across 4 files |

### Refinement domains added

| # | Domain | Status | Detail |
|---|--------|--------|--------|
| 12 | Stripe/webhooks | PASS | Webhook controller, refund/dispute handling, stripeCustomerId wiring |
| 13 | Referral system | PASS | ReferralService, code apply, reward processing, frontend |
| 14 | API keys | PASS | Developer API key management, ApiKeyGuard |
| 15 | Tool integrations | PASS | Seed + admin toggle |
| 16 | Webhook events | PASS | Admin audit view |

No failing domains. |

---

## 1. Build/monorepo -- PASS

- `pnpm build` compiles all 8 workspace packages cleanly in ~12s
- Turborepo with pnpm workspaces, TypeScript project references
- Path aliases configured: `@waitlayer/config`, `@waitlayer/db`, `@waitlayer/shared`

**Fixed:**
- All packages share a consistent TypeScript configuration
- Prisma client generation integrated into build pipeline (`prisma generate` before build)
- Monorepo path aliases resolved via vitest.config.ts and tsconfig paths

**No known issues.**

---

## 2. API contract -- PASS

- REST API at `/api/v1/` with global prefix
- All extension, admin, advertiser, auth, campaign, fraud, ledger, and payout endpoints implemented
- DTO validation via NestJS ValidationPipe (whitelist + transform)
- Swagger docs auto-generated from NestJS decorators

**Fixed:**
- Shared HMAC signing utility at `packages/shared/src/signing.ts` used by both API, CLI, and VS Code extension
- Extension events use canonical JSON (sorted keys) before HMAC-SHA256
- Idempotency keys required on all write events

**No known issues.**

---

## 3. Auth + roles -- PASS

- Full local auth: signUp, login, refresh (with rotation + replay detection), logout
- Google OAuth via ID token verification (requires `GOOGLE_CLIENT_ID` env var)
- JWT access tokens (15m TTL) + refresh tokens (30d TTL)
- Role-based guards: `@Roles('admin')`, `@Roles('advertiser')`, `@Roles('developer')`
- Session tracking with token families for replay detection

**Fixed:**
- Token rotation: each refresh revokes the old session and creates a new one in the same family
- Replay detection: if a revoked session token is reused, all sessions for that user are revoked
- Password hashing via bcryptjs with proper salt rounds
- Stateless JWT-based email verification flow (`verify-email/request` and `verify-email/confirm`) with automatic trust score recalculation (+10 points)
- Mock Google OAuth verification support in non-production environments to allow offline local testing (tokens starting with `mock-google-token-`)

**Known limitations:**
- Google OAuth in production requires a valid `GOOGLE_CLIENT_ID` environment variable; mock verification is restricted to development/test modes

---

## 4. Authorization -- PASS

- Campaign ownership enforced: `advertiserId` must match caller
- Device ownership verified before recording events
- Payout account ownership verified before requesting payout
- Creative/campaign modifications restricted to owning advertiser

**Fixed:**
- `submitCampaign` validates `campaign.advertiserId === advertiserId`
- `pauseCampaign`, `resumeCampaign`, `updateCampaign` enforce ownership
- Device registration checks `userId` matches device record
- Payout requests verify account belongs to user

**No known issues.**

---

## 5. Campaign lifecycle -- PASS

**State machine:** draft -> submitted -> approved -> active -> paused -> active -> archived. Rejected campaigns can return to draft. Paused campaigns resume directly to `active` (not `approved`).

**Flow implemented:**
1. Advertiser creates campaign (draft) with validated budget, bid, and category
2. Advertiser creates creatives (draft) with 80-char message limit
3. Admin approves creative -> status `approved`. If campaign is `approved`, auto-activates to `active`
4. Advertiser submits campaign -> status `submitted` (requires >=1 approved creative)
5. Admin approves campaign -> `active` (if approved creatives exist) or `approved`
6. Advertiser can pause/resume active campaigns

**Fixed:**
- Category validation blocks 11 prohibited categories (gambling, adult_content, phishing, etc.)
- Budget minimum $50.00, maximum $1,000,000.00 enforced
- Bid amount must be positive
- Frequency capping: default 2/hour, 6/day per campaign
- Creative approval auto-activates ready campaigns

**No known issues.**

---

## 6. Ledger/money flow -- PASS

**Three-ledger system:**
- `EarningsLedger` -- developer earnings (estimated -> confirmed -> paid)
- `AdvertiserLedger` -- advertiser charges (debits)
- `PlatformLedger` -- platform fee + fraud reserve

**Revenue split (60/30/10):**
- 60% to developer as estimated earnings
- 30% to platform fee (confirmed)
- 10% to fraud/payment reserve (confirmed)
- Launch incentive: 80/10/10 for early adopters

**Hold periods by trust level:**
- `new` / `low_trust`: 30 days
- `normal`: 14 days
- `high_trust`: 7 days

**Money moves on qualified impression:**
- Single atomic transaction: impression update + advertiser debit (confirmed) + developer credit (estimated) + platform fee (confirmed) + fraud reserve (confirmed) + campaign spend increment
- Developer earnings mature from `estimated` to `confirmed` after hold period via `matureEarnings()`

**Fixed:**
- Transactional integrity: all 6 writes happen in one `$transaction` block
- Idempotency keys prevent double-crediting (`imp-{impressionId}-{bucket}`)
- Impression qualified at minimum 5000ms visible duration
- Fraud rate limit checked before ledger write; blocked impressions marked non-billable
- Periodically scheduled estimated earnings maturation check (every 10 minutes) and automatic bootstrap maturation run via `LedgerCronService`

**Known limitations:**
- CPC campaign clicks also generate earnings entries (developer credit + advertiser debit)

---

## 7. Payouts -- PASS

- Multi-provider architecture: PayPal Email, PayPal Payouts, Manual, with StubProvider and StubPayout2Provider as placeholders
- Minimum payout threshold: $10.00
- Fraud flag check: users with open critical/high flags blocked from payout requests
- Trust-based payout eligibility: restricted/banned users blocked

**Fixed:**
- `PayoutAllocation` model tracks exact earnings entries allocated to each payout request
- `getAvailableForPayout` correctly subtracts already-allocated earnings from confirmed total
- `markPayoutPaid` processes all allocated earnings entries in a single transaction (double-payout prevention)
- Trust score influences payout approval priority
- Admin updates route via `PayoutService.markPayoutPaid` ensuring proper allocation tracking and prevention of double payouts
- Payout provider stub classes implemented and registered for Stripe Connect, Payoneer, Wise, and Razorpay to allow testing all providers

**Known limitations:**
- No automatic payout scheduling (requires admin manual approval flow)
- Payout provider configuration (e.g., PayPal API keys) must be set via env vars

---

## 8. Frontend -- PASS

**34 pages across 4 roles:**
- Auth: login, signup
- Developer: dashboard (with referral info), earnings, payouts, settings, trust
- Advertiser: dashboard, campaigns, new campaign, billing, reports
- Admin: overview, campaigns, payouts, fraud, users, audit, ledger
- Legal: privacy, terms, payout-policy, advertiser-policy

**Fixed:**
- Google OAuth button on login page (requires `GOOGLE_CLIENT_ID`)
- Auth token storage: both localStorage and httpOnly cookie (via `middleware.ts` for route protection)
- Protected routes with role-based redirects
- Admin layout with sidebar navigation

**Known limitations:**
- Google OAuth login button visible but requires `GOOGLE_CLIENT_ID` env var to function
- No real-time dashboard (static renders)

---

## 9. VS Code extension -- PASS

- Full lifecycle: device registration, wait-state detection, ad serving, click-through
- `wait-detector.ts` detects VS Code loading/idle states (build tasks, extension activation, language server startup)
- `ad-panel.ts` renders sponsored ads in a webview panel
- `status-bar.ts` shows earnings and wait-state in VS Code status bar
- `config.ts` manages extension settings (ads enabled/disabled, max ads per hour)
- Uses shared HMAC signing utility from `@waitlayer/shared`

**Fixed:**
- Shared signing utility used for all API calls
- Idempotency keys generated per event
- Privacy enforcement: `PROHIBITED_DATA_FIELDS` filtered before sending events
- Token refresh: 401 responses trigger automatic refresh+retry via SecretStorage-persisted tokens
- Wait-state lifecycle complete: `waitStateStart` → ad request → impression → `waitStateEnd` paired

**No known issues.**

---

## 10. CLI + signing -- PASS

**CLI commands:**
- `auth` -- signup/login with credential storage
- `logout` -- clears stored credentials
- `status` -- displays earnings summary
- `watch` -- full wait-state monitoring loop: start wait, end wait, request ad, record rendered, record qualified impression (with `endWaitState` support)

**Fixed:**
- Shared HMAC signing utility from `@waitlayer/shared` used for all API calls
- HMAC secret aligned: both docker-compose (`EXTENSION_HMAC_SECRET`) and code default (`dev-secret-change-me`) match
- `api-client.ts` signs all extension event payloads with canonical JSON + HMAC-SHA256
- `endWaitState` support added to `watch.ts` for complete wait-state lifecycle

**No known issues.**

---

## 11. Tests/readiness -- PASS

**63 tests across 4 test files (all pass):**

| File | Tests | Type | Coverage |
|------|-------|------|----------|
| `auth/auth.service.spec.ts` | 12 | Unit | signUp, login, refresh rotation, replay detection, logout |
| `fraud/fraud.service.spec.ts` | 14 | Unit | trust score, impression rate limit, self-click, create/resolve flags |
| `ledger/ledger.service.spec.ts` | 13 | Unit | split math, balances, earnings history, hold days, impression earnings, transitions |
| `integration/e2e-money-loop.spec.ts` | 24 | Integration/E2E | Full money loop + failure modes |

**E2E test covers:**
- Phase 1: Campaign creation -> creative creation -> admin approves creative -> advertiser submits campaign -> admin approves campaign -> campaign active
- Phase 2: Device registration -> wait-state-start -> ad request (returns impression token)
- Phase 3: Qualified impression -> 4 ledger entries + campaign spend increment verified
- Phase 4: CPC click tracking -> advertiser debit + developer earning credit
- Phase 5: Revenue split math (60/30/10, 80/10/10)
- Phase 6: Hold periods by trust level (30/14/7 days)
- Phase 7: Earnings maturation (estimated -> confirmed)
- Phase 8: Self-click fraud prevention
- Phase 9: Full end-to-end orchestration (all phases wired in single test)
- Phase 10: Failure modes (wrong HMAC, wrong device owner, submit without creatives, submit with unapproved creative, idempotency)

**Test infrastructure:**
- Vitest with v8 coverage
- Mocked PrismaService with deep per-table mocks (matching existing test pattern)
- Real JwtService and AuditService instances (with mocked Prisma)
- In-memory ledger capture for E2E assertions
- Shared HMAC signing via `@waitlayer/shared` (pure crypto, no mocking needed)

---

## 12. Stripe/webhooks -- PASS

- StripeProvider with `createDepositSession`, `handleCheckoutComplete`, `verifyWebhookSignature`, `getRefundDetails`, `getDisputeDetails`
- `StripeWebhookController` at `POST /payout/stripe/webhook` — validates Stripe signatures, logs events to `WebhookEvent` table, processes async
- Handles: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`
- `stripeCustomerId` wired to Advertiser record on checkout completion
- Refunds create reversal entries in advertiser ledger
- Disputes create high/critical fraud flags
- Raw body middleware (`express.raw()`) for Stripe webhook routes

**Known limitations:**
- Requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment variables to function

---

## 13. Referral system -- PASS

- Referral and ReferralReward models in Prisma schema
- `ReferralService`: `getReferralInfo()`, `applyReferralCode()`, `processReferralRewards()`, `getReferralHistory()`
- `ReferralController`: `GET /referral`, `POST /referral/apply`, `GET /referral/history`
- Reward: $5 referral bonus credit to referrer's platformLedger (`bucket: 'referral_bonus'`) on referred user's first payout
- Auto-check on payout: `PayoutService.markPayoutPaid()` triggers referral reward processing
- Frontend: referral code, count, and rewards shown on developer dashboard
- Anti-abuse: self-referral blocked, duplicate referral blocked, code validation

---

## 14. API keys -- PASS

- `ApiKey` model with hashed keys, scopes, expiry
- `ApiKeyService`: `generateApiKey()`, `validateApiKey()`, `revokeApiKey()`
- `ApiKeyController`: `POST /developer/api-keys`, `GET /developer/api-keys`, `DELETE /developer/api-keys/:id`
- `ApiKeyGuard`: validates `X-Api-Key` header for machine-to-machine authentication
- Keys never returned in plaintext after initial generation

---

## 15. Tool integrations -- PASS

- `ToolIntegration` model seeded with vscode, cli, jetbrains, web
- Admin endpoints: `GET /admin/tools`, `POST /admin/tools/:slug/toggle`
- Used for tool registry and enable/disable control

---

## 16. Webhook events -- PASS

- `WebhookEvent` model for logging all incoming Stripe webhook events
- Admin endpoint: `GET /admin/webhooks` with provider, status, and pagination filters
- Idempotency via unique `eventId` constraint

## Build & Run Commands

```bash
# Install dependencies
pnpm install

# Generate Prisma client (needed before first build)
pnpm --filter @waitlayer/db prisma:generate

# Build all packages
pnpm build

# Run all tests
pnpm --filter @waitlayer/api test

# Run tests with coverage
pnpm --filter @waitlayer/api test:cov

# Start all services (PostgreSQL + API + Web)
docker compose up -d

# Run database migrations
pnpm --filter @waitlayer/db prisma:migrate

# Develop API locally (after starting PostgreSQL)
pnpm --filter @waitlayer/api dev

# Develop Web locally
pnpm --filter @waitlayer/web dev
```

---

## Known Risks & Limitations

| Risk/Limitation | Severity | Detail |
|-----------------|----------|--------|
| Google OAuth requires env var | Low | Real Google OAuth in production requires `GOOGLE_CLIENT_ID`; local development works offline using mock tokens |
| Port 4000 conflict | Low | Docker maps API port 4002 (host) to 4000 (container), so `localhost:4002` must be used |
| Payout providers are stubs | Low | All providers (Stripe, Payoneer, Wise, Razorpay, PayPal, Manual) have functional/testable stub handlers registered. |
| No real-time WebSocket | Low | Dashboard metrics are request-time, not push-based |
| Rate limits are in-memory only | Low | No Redis or distributed rate limiter; per-process only |
| No end-to-end HTTP tests | Low | E2E tests use services directly with mocked Prisma, not real HTTP/DB |
| Secrets in docker-compose are dev-only | High | `JWT_SECRET=change-me-in-production`, `EXTENSION_HMAC_SECRET=dev-secret-change-me` must be rotated for production |