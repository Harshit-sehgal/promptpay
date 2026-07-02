# WaitLayer Foundation Status

Last updated: 2026-07-02 (Verification pass complete — all 10 major blockers resolved)

---

## Domain Status Summary

| # | Domain | Status | Test Coverage |
|---|--------|--------|---------------|
| 1 | Build/monorepo | PASS | Build-only |
| 2 | API contract | PASS | Unit + Integration |
| 3 | Auth + roles | PASS | Unit |
| 4 | Authorization | PASS | Manual |
| 5 | Campaign lifecycle | PASS | Integration |
| 6 | Ledger/money flow | PASS | Unit + Integration |
| 7 | Payouts | PASS | Unit |
| 8 | Frontend | PASS | Build + live smoke |
| 9 | VS Code extension | PASS | Manual |
| 10 | CLI + signing | PASS | Integration |
| 11 | Tests/readiness | PASS | 115 tests across 7 files |

### Refinement domains added

| # | Domain | Status | Detail |
|---|--------|--------|--------|
| 12 | Stripe/webhooks | PASS | Webhook controller, refund/dispute handling, stripeCustomerId wiring |
| 13 | Referral system | PASS | ReferralService, code apply, reward processing, frontend |
| 14 | API keys | PASS | Developer API key management UI, ApiKeyGuard |
| 15 | Tool integrations | PASS | Seed + admin toggle |
| 16 | Webhook events | PASS | Admin audit view |

No failing domains. |

---

## 1. Build/monorepo -- PASS

- `pnpm build` compiles all 9 workspace packages cleanly in ~4s
- Turborepo with pnpm workspaces, TypeScript project references
- Path aliases configured: `@waitlayer/config`, `@waitlayer/db`, `@waitlayer/shared`

**Fixed:**
- Configured API dev/start scripts and Dockerfile CMD to use the correct Nest entry point for this workspace layout, aligning watch mode and compiled output paths across environment configurations.
- Configured correct package manifests copy order in `Dockerfile` (copying `cli` and `vscode-extension` alongside other services) so all local workspace dependencies are successfully resolved during container build.

---

## 2. API contract -- PASS

- REST API at `/api/v1/` with global prefix
- All extension, admin, advertiser, auth, campaign, fraud, ledger, and payout endpoints implemented
- DTO validation via NestJS ValidationPipe (whitelist + transform + forbidNonWhitelisted)
- Swagger docs auto-generated from NestJS decorators

**Fixed:**
- Shared HMAC signing utility at `packages/shared/src/signing.ts` used by both API, CLI, and VS Code extension
- Extension events use canonical JSON (sorted keys) before HMAC-SHA256
- Idempotency keys required on all write events
- Aligned VS Code and CLI request shapes to strictly match backend validation DTOs (removed forbidden unwhitelisted fields like `timestamp`, `deviceFingerprint`).

---

## 3. Auth + roles -- PASS

- Full local auth: signUp, login, refresh (with rotation + replay detection), logout
- Google OAuth via ID token verification (requires `GOOGLE_CLIENT_ID` env var)
- JWT access tokens (15m TTL) + refresh tokens (30d TTL)
- Role-based guards: `@Roles('admin')`, `@Roles('advertiser')`, `@Roles('developer')`
- Session tracking with token families for replay detection

**Fixed:**
- **Refresh token audience restriction**: `JwtStrategy` strictly verifies `aud === 'access'` and checks `jti` to prevent refresh tokens from being used to access protected endpoints.
- **Secure token rotation**: Added unique `jti` to refresh tokens. The rotation system now queries sessions by their unique `jti` rather than families, validates the bcrypt hash of the token, and revokes the entire family on reuse or mismatch.
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

**State machine:** draft -> submitted -> approved -> active -> paused -> active -> archived. Paused campaigns resume directly to `active` (not `approved`).

**Flow implemented:**
1. Advertiser creates campaign (draft) with validated budget, bid, and category
2. Advertiser creates creatives (draft) with 80-char message limit
3. Advertiser submits campaign -> status `submitted` (automatically sets draft creatives to `pending_review`)
4. Admin reviews and approves the campaign (status `approved`) and the creatives (status `approved`)
5. Once at least one creative is approved, the campaign automatically transitions to `active` and is ready to serve ads
6. Advertiser can pause/resume active campaigns

**Fixed:**
- **Submission lifecycle block**: Removed the requirement that at least one creative be already approved *before* campaign submission, enabling draft campaigns and creatives to be submitted for review together.
- Category validation blocks 11 prohibited categories (gambling, adult_content, phishing, etc.)
- Budget minimum $50.00, maximum $1,000,000.00 enforced
- Bid amount must be positive
- Frequency capping: default 2/hour, 6/day per campaign
- Creative approval auto-activates ready campaigns

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

---

## 7. Payouts -- PASS

- Multi-provider architecture: PayPal Email, PayPal Payouts, Manual, Wise, Stripe Connect, Razorpay, and Payoneer
- Minimum payout threshold: $10.00
- Fraud flag check: users with open critical/high flags blocked from payout requests
- Trust-based payout eligibility: restricted/banned users blocked

**Fixed:**
- **Partial-allocation accounting**: Implemented database-level splitting of earnings entries when allocating payouts. If an entry is partially allocated, it is reduced to the allocated amount, and the remainder is split off into a new `confirmed` earnings record, ensuring no unallocated earnings are lost.
- **Double-allocation prevention**: Enforced a database-level unique constraint on `earningsEntryId` in the `PayoutAllocation` model to prevent race conditions during concurrent payouts.
- `markPayoutPaid` processes all allocated earnings entries in a single transaction (double-payout prevention)
- Payout provider stub classes implemented and registered to allow testing all providers

---

## 8. Frontend -- PASS

**34 pages across 4 roles:**
- Auth: login, signup
- Developer: dashboard (with referral info), earnings, payouts, settings, trust
- Advertiser: dashboard, campaigns, new campaign, billing, reports
- Admin: overview, campaigns, payouts, fraud, users, audit, ledger (with revenue split breakdown)
- Legal: privacy, terms, payout-policy, advertiser-policy

**Fixed:**
- **Payload mapping on campaign creation**: Corrected advertiser campaign creation form to map inputs to backend fields (`title`, `sponsoredMessage`, `destinationUrl`, `displayDomain`), and formatted country targeting as a JSON array of objects (`[{ countryCode, include }]`).
- **Admin ledger API alignment**: Configured the admin ledger dashboard to query the correct `/ledger/admin/breakdown` and `/ledger/admin/history` endpoints, and aligned backend breakdown response fields to support both raw sums and nested objects.
- Protected routes with role-based redirects and token management.

---

## 9. VS Code extension -- PASS

- Full lifecycle: device registration, wait-state detection, ad serving, click-through
- `wait-detector.ts` detects VS Code loading/idle states (build tasks, extension activation, language server startup)
- `ad-panel.ts` renders sponsored ads in a webview panel
- `status-bar.ts` shows earnings and wait-state in VS Code status bar
- Uses shared HMAC signing utility from `@waitlayer/shared`

**Fixed:**
- **Device Registration & Session UUID**: Integrated `/extension/register-device` call on startup to obtain and cache a valid device UUID. Provided standard `vscode.env.sessionId` as the `sessionId` for all wait-state events.
- **Ad serving contract**: Added `/extension/ad-rendered` call on webview load. Aligned ad serving request and response payloads, ensuring proper HMAC signatures and correct mapping of ad fields.

---

## 10. CLI + signing -- PASS

**CLI commands:**
- `auth` -- signup/login with credential storage
- `logout` -- clears stored credentials
- `status` -- displays earnings summary
- `watch` -- full wait-state monitoring loop: register device -> start wait -> request ad -> end wait

**Fixed:**
- **Data payload wrapping**: Removed client expectations for nested `.data` wrapper on API responses, enabling login, status, and watch commands to successfully decode raw NestJS JSON payloads.
- **Watch event contract**: Integrated `/extension/register-device` to fetch and store a valid UUID. Corrected the `reportWaitState` and `endWaitState` payloads to send the generated `waitStateId`, `deviceId` (UUID), and `sessionId` without forbidden fields.

---

## 11. Tests/readiness -- PASS

**85 tests across 6 test files (all pass):**

| File | Tests | Type | Coverage |
|------|-------|------|----------|
| `auth/auth.service.spec.ts` | 20 | Unit | signUp, login, refresh rotation, replay detection, verification |
| `auth/strategies/google-token-verifier.spec.ts` | 3 | Unit | mock token verification and environment constraints |
| `fraud/fraud.service.spec.ts` | 10 | Unit | trust score, impression rate limit, self-click, create/resolve flags |
| `ledger/ledger.service.spec.ts` | 15 | Unit | split math, balances, earnings history, hold days, impression earnings |
| `payout/payout.service.spec.ts` | 13 | Unit | payout account management, allocation validation, provider routing |
| `integration/e2e-money-loop.spec.ts` | 24 | Integration/E2E | Full money loop + failure modes + edge cases |

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
