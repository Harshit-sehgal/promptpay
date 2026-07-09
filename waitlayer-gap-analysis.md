# WaitLayer (PromptPay) — Comprehensive Gap Analysis

**Generated:** July 8, 2026  
**Total Gaps:** 158  
**Analysis Rounds:** 13  
**Files Examined:** 100+ source files across all packages and apps

> **Current source-audit note (2026-07-09):** This file is the historical
> 158-gap closure summary. The live source-backed readiness register is
> `AGENTS.md`; current open items are A-030, A-033, A-074, A-075, A-076,
> A-077, A-078, A-079, A-080, and A-081.
>
> **Closure status (2026-07-09):** All 158 original gaps have been verified against the
> current source and closed. Genuinely-missing behavior was implemented; already-done items
> were confirmed; a small set of pre-existing test/schema issues uncovered while running
> the DB-backed suite were fixed. See **`FOUNDATION_STATUS.md` → "Recently Completed
> (2026-07-09)"** for the per-gap record and the final verification output
> (`typecheck` 14/14, `lint` 9/9 @ 0 warnings, `build` 9/9, `test` green — exact count regenerated per pass; see FOUNDATION_STATUS.md / AGENTS.md for the live total).

---

## Executive Summary

A systematic gap analysis of the WaitLayer codebase identified **158 gaps** across **9 thematic categories**:

| Category                | Count | Description                                      |
| ----------------------- | ----- | ------------------------------------------------ |
| 🛡️ Security             | 22    | +2: Docker root user, no CI audit                |
| 🔧 Operations           | 24    | +1: retention cron no seed                       |
| 🎨 Frontend/UX          | 23    | +1: middleware login flicker                     |
| 🧪 Testing              | 11    | +2: auth banned-user gap, payout zero-amount gap |
| 💰 Money Integrity      | 8     |                                                  |
| 📋 Compliance/Legal     | 8     |                                                  |
| 🏗️ Architecture         | 15    | +2: referral string enum, no CHECK constraints   |
| 📖 Documentation        | 10    |                                                  |
| 🔄 Developer Experience | 12    | +1: turbo build/typecheck dependency             |

**Severity Distribution:**

| Severity    | Count |
| ----------- | ----- |
| 🔴 Critical | 30    |
| 🟡 Medium   | 86    | (+7) |
| 🔵 Low      | 42    | (+2) |

---

## 🔴 Critical Gaps (30)

### Security (7)

| #   | Gap                                                         | Module            | Description                                                                                            |
| --- | ----------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Developer-Side 2FA UX Not Implemented                       | Frontend          | Backend TOTP endpoints exist but web frontend has no 2FA settings UI — no QR code, enable/disable flow |
| 77  | VS Code Extension Login Doesn't Support TOTP 2FA            | VS Code Extension | `promptLogin()` passes `{email, password}` only — no `twoFactorToken` field                            |
| 137 | TOTP Encryption Key Dev Fallback Breaks on JWT Rotation     | Auth              | Dev fallback derives key from JWT_SECRET — rotating JWT_SECRET renders all TOTP secrets undecryptable  |
| 125 | API Error Responses Have No Consistent Envelope             | API               | 4+ different error shapes; clients can't parse errors uniformly                                        |
| 118 | DTO Validation Error Messages Inconsistent                  | API               | Some custom, most defaults, no localization                                                            |
| 117 | DTO Password Validation Too Weak                            | API               | Only min/max length — no complexity requirements, no common-password blacklist                         |
| 84  | Auth Cookies Missing `__Host-` Prefix and `SameSite=Strict` | Web               | Cookies set httpOnly/secure but not SameSite; no `__Host-` prefix for subdomain protection             |

### Money Integrity (3)

| #   | Gap                                                  | Module | Description                                                                                                   |
| --- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 41  | Launch Incentive Split Never Applied                 | Ledger | `calculateSplit(amount, false)` — every call site uses default `false`; 80/10/10 launch split never activates |
| 42  | TOTP Encryption Degrades Silently to Zero Key in Dev | Auth   | When `TOTP_SECRET_ENCRYPTION_KEY` is unset, `Buffer.alloc(32)` is used — all-zeros key with no warning        |
| 44  | No Graceful Shutdown Handler                         | API    | No SIGTERM/SIGINT handler, no request draining, no DB pool draining                                           |

### Operations (7)

| #   | Gap                                                 | Module     | Description                                                                                                                      |
| --- | --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 106 | No Structured Logging                               | API        | `console.log`/`Logger.log` with string interpolation everywhere — no JSON logs, no machine-parseable fields                      |
| 78  | Docker CMD Has No Postgres-Readiness Wait           | DevOps     | Standalone deployments have no readiness wait for Postgres                                                                       |
| 114 | Swagger/OpenAPI Installed But Zero Decorators Exist | API        | `@nestjs/swagger` in package.json but zero `@ApiProperty()`/`@ApiTags()`/`@ApiOperation()` decorators                            |
| 79  | CI Pipeline Doesn't Run VS Code Extension Tests     | CI/CD      | Extension has zero tests and CI doesn't enforce build correctness                                                                |
| 80  | No Prisma Schema Drift Detection in CI              | CI/CD      | No `prisma migrate diff` step — schema drift passes CI and fails at deploy                                                       |
| 103 | Stripe Webhook Processing Is Synchronous            | API        | Webhook processing blocks HTTP thread — could exceed LB timeouts, reduces throughput                                             |
| 152 | Data Retention Cron Has No Default Config Seed      | Operations | `DataRetentionConfig` table has no seed data — retention cron reads from it but with no rows inserted, retention never auto-runs |

### Frontend/UX (5)

| #   | Gap                                           | Module | Description                                                                                                                                                      |
| --- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Missing Public Policy Pages                   | Web    | Payout Policy, Advertiser Policy, FAQ, Security page — referenced but 404                                                                                        |
| 91  | No Route-Specific Error Boundaries            | Web    | Zero `error.tsx`/`not-found.tsx` in sub-routes — errors bubble to root                                                                                           |
| 21  | Access Token Leak via Proxy                   | Web    | Non-auth API responses stripped by proxy but raw API direct access leaks tokens                                                                                  |
| 115 | No Next.js Image Optimization                 | Web    | Zero `next/image` usage — all native `<img>` tags                                                                                                                |
| 153 | Middleware Login Flash on Access Token Expiry | Web    | Middleware runs server-side before page load — when access token expires (15m TTL), users see a full redirect to `/auth/login` before client refresh can recover |

### Testing (6)

| #   | Gap                                                  | Module  | Description                                                                                                                                                                                    |
| --- | ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | No Rate Limit Testing / Load Testing                 | Testing | Zero load tests, stress tests, benchmarks                                                                                                                                                      |
| 3   | VS Code Extension Untested                           | Testing | Extension has zero unit tests and zero integration tests                                                                                                                                       |
| 23  | No Rate Limiting on Auth Endpoints                   | API     | No per-email rate limit on forgot-password or email-verification                                                                                                                               |
| 63  | No Rate Limiting on 2FA Endpoints                    | API     | 2FA setup/enable/disable not separately rate limited                                                                                                                                           |
| 154 | Auth Spec Missing Test for Banned/Deleted User Login | Testing | Auth service tests cover MFA, Google OAuth, password reset, and replay detection — but no test asserts that login with `status='banned'` or `status='deleted'` returns `UnauthorizedException` |
| 155 | Payout Spec Missing Test for Zero/Negative Amount    | Testing | Payout service tests cover insufficient funds, fraud flags, and MFA gating — but no test verifies requesting 0 or a negative amount is rejected                                                |

### Compliance (2)

| #   | Gap                                          | Module | Description                                                               |
| --- | -------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| 61  | Audit Events Silently Lost During DB Outages | API    | `AuditService.log()` is fire-and-forget — no queue, no retry, no fallback |
| 66  | Data Export Endpoint Has No Implementation   | API    | `POST /developer/export-data` is a stub — no file, no job, no email       |

### Architecture (6)

| #   | Gap                                                | Module | Description                                                                                                                                  |
| --- | -------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 22  | No CSRF Protection on Auth Endpoints               | Web    | Cookies use `SameSite=Lax`; no CSRF token anywhere                                                                                           |
| 62  | Health Check Never Validates Redis                 | API    | `GET /health` checks Postgres but not Redis                                                                                                  |
| 24  | CLI Credentials Stored in World-Readable Directory | CLI    | Token file permissions not explicitly set                                                                                                    |
| 25  | Google OAuth Mock Token Allows Bypass              | Auth   | Mock token format `mock-google-token-{role}` — staged with NODE_ENV=development could bypass                                                 |
| 156 | Referral Status Stored as Plain String, Not Enum   | DB     | `Referral.status` is `String @default("pending")` with no DB-level constraint — invalid values like "pendng" or "compleeted" pass silently   |
| 157 | No DB-Level CHECK Constraints on Monetary Columns  | DB     | No `CHECK (amountMinor >= 0)` or `CHECK (bidAmountMinor > 0)` — application code prevents negative values but there's no DB-level safety net |

---

## 🟡 Medium-Severity Gaps (79)

### Security (13)

| #   | Gap                                                   | Module     |
| --- | ----------------------------------------------------- | ---------- |
| 138 | Password Fingerprint Constant for Google-Only Users   | Auth       |
| 86  | Webhook Endpoint Has No IP-Based Rate Limiting        | API        |
| 85  | Middleware Reads JWT_SECRET With No Missing-Env Guard | Web        |
| 81  | No X-Request-Id Returned in Response Headers          | API        |
| 26  | Proxy Allowlist Drift Risk                            | Web        |
| 27  | No Password Complexity Requirements                   | Auth       |
| 28  | Password Reset Token Not Single-Use                   | Auth       |
| 34  | No CSP on Admin UI Against XSS                        | Web        |
| 143 | sanitizeUser Doesn't Strip googleId/githubId          | API        |
| 65  | Consent Re-Prompt Flow Missing                        | Compliance |
| 68  | Swagger Documentation Incomplete                      | API        |
| 67  | TOTP Code Validation Has No Input Trimming            | Auth       |
| 119 | No Prisma.InputJsonValue Runtime Validation           | API        |

### Money Integrity (5)

| #   | Gap                                                                | Module |
| --- | ------------------------------------------------------------------ | ------ |
| 46  | PLATFORM_BUCKETS.CASH Bucket Never Written                         | Ledger |
| 47  | Phanton Reads Possible in READ COMMITTED                           | Ledger |
| 64  | Platform Split Has No Positive-Value Guard                         | Ledger |
| 142 | Recovery Debt Cases Created With No Min Amount Validation          | Admin  |
| 140 | getPayoutInfo Runs 5 Queries in Promise.all — Single Failure = 500 | Payout |

### Operations (17)

| #   | Gap                                                 | Module       |
| --- | --------------------------------------------------- | ------------ |
| 4   | No Monitoring / Alerting Configuration              | Operations   |
| 45  | PayoutCronService Has No Per-Provider Timeout       | Payout       |
| 82  | CI Pipeline Timeout is Tight at 15 Minutes          | CI/CD        |
| 87  | Referral Link Has No Frontend Attribution           | Web          |
| 88  | Marketing Pages Missing From Cache Config           | Web          |
| 104 | API Health Endpoint Never Returns Redis Status      | API          |
| 105 | Prisma Client Uses Default Connection Pool Settings | API          |
| 126 | No Pre-Commit Hooks for Lint/TypeCheck              | DX           |
| 129 | No Docker Compose Override for Local Development    | DevOps       |
| 130 | No Hot Reload Configuration                         | DX           |
| 131 | No Message Queue / Event Bus                        | Architecture |
| 136 | All Cron Intervals Hardcoded — Not Configurable     | Operations   |
| 139 | addPayoutMethod Transaction Issues                  | Payout       |
| 141 | parseTtlToMs Only Supports Simple Single-Unit TTLs  | Auth         |
| 30  | No Auto-Update Mechanism for CLI                    | CLI          |
| 31  | No Retry Logic on Network Failures for CLI          | CLI          |
| 43  | Email Service Bypasses Validated Config             | Email        |

### Frontend/UX (14)

| #   | Gap                                                       | Module |
| --- | --------------------------------------------------------- | ------ |
| 83  | Many Pages Missing loading.tsx                            | Web    |
| 92  | No i18n / Localization Infrastructure                     | Web    |
| 93  | UserSettings.adsEnabled Defaults to true Without Consent  | Web    |
| 94  | Admin Pages Missing noindex Meta Tags                     | Web    |
| 95  | TrustScore.accountAgePoints Stored But Never Computed     | API    |
| 96  | Seed Data is Minimal — No Demo Data                       | DB     |
| 97  | formatRelativeTime Lacks Precision                        | Web    |
| 99  | Comparison Page Lists Incorrect/Misleading Data           | Web    |
| 107 | Admin Pages Missing Loading/Empty/Error States            | Web    |
| 108 | PayoutRequestResponse Returns Null Fields Pre-Processing  | Web    |
| 109 | No User Schema Exposes twoFactorEnabled                   | Web    |
| 116 | No React.lazy() or Dynamic Imports                        | Web    |
| 120 | Campaign currency/category Have No Server-Side Validation | API    |
| 123 | No Frontend Toast/Notification System                     | Web    |

### Testing (5)

| #   | Gap                                              | Module  |
| --- | ------------------------------------------------ | ------- |
| 128 | No Red/Green Tests for Campaign Lifecycle        | Testing |
| 132 | No E2E Tests for Campaign or Extension API Flows | Testing |
| 6   | No E2E Tests for Admin Workflows                 | Testing |
| 7   | No Visual Regression Testing                     | Testing |
| 8   | No Contract Test for API Key Scopes              | Testing |

### Compliance/Legal (6)

| #   | Gap                                         | Module     |
| --- | ------------------------------------------- | ---------- |
| 124 | No Data Export Format Specified             | Compliance |
| 9   | No Cookie Consent Banner                    | Compliance |
| 10  | No GDPR Data Processing Agreement Available | Compliance |
| 11  | No CCPA Opt-Out Mechanism                   | Compliance |
| 12  | No Age Verification                         | Compliance |
| 13  | No User Feedback/Survey Mechanism           | Compliance |

### Architecture (10)

| #   | Gap                                               | Module |
| --- | ------------------------------------------------- | ------ |
| 98  | Google Token Verifier Reads process.env Directly  | Auth   |
| 100 | API Middleware Not Wrapped in MiddlewareConsumer  | API    |
| 101 | No Cache-Control Headers on API Responses         | API    |
| 102 | DataRetentionConfig Has No createdAt              | DB     |
| 110 | Config Validation Duplicates Wise .refine() Rules | Config |
| 127 | No Architecture Decision Records (ADRs)           | Docs   |
| 29  | Email Leaks Provider Status                       | Email  |
| 33  | No Inactive Session Timeout Warning               | Auth   |
| 35  | No Rate Limit on Admin Proxy Routes               | Admin  |
| 113 | favicon.svg Referenced But favicon.ico Missing    | Web    |

### Documentation (5)

| #   | Gap                                    | Module |
| --- | -------------------------------------- | ------ |
| 134 | No Onboarding Guide for New Developers | Docs   |
| 135 | No Port Conflict Documentation         | Docs   |
| 14  | No API Changelog                       | Docs   |
| 15  | No Troubleshooting Guide               | Docs   |
| 17  | No Style Guide Beyond ESLint           | Docs   |

### Developer Experience (4)

| #   | Gap                                                     | Module |
| --- | ------------------------------------------------------- | ------ |
| 133 | No Makefile or Task Runner Shortcuts                    | DX     |
| 144 | enforcePrivacyOn Creates Unnecessary Object Allocations | API    |
| 16  | No huppy/dependabot Configuration                       | DX     |
| 18  | No Storybook for Component Development                  | DX     |

---

## 🔵 Low-Severity Gaps (40)

### Security (0)

_(No low-severity security gaps identified)_

### Money Integrity (0)

_(All money-integrity gaps are medium or critical)_

### Operations (6)

| #   | Gap                                          | Module |
| --- | -------------------------------------------- | ------ |
| 111 | No Web App Health Endpoint                   | Web    |
| 112 | STRIPE_PUBLISHABLE_KEY/PUBLIC_KEY Confusion  | Config |
| 31  | No Retry Logic on Network Failures           | CLI    |
| 32  | Missing CreatedAt/UpdatedAt Timestamps       | DB     |
| 36  | No Database Migration Rollback Documentation | Docs   |
| 37  | No AWS/GCP Deployment Scripts                | DevOps |

### Frontend/UX (8)

| #   | Gap                                    | Module |
| --- | -------------------------------------- | ------ |
| 19  | Missing Favicon Fallback               | Web    |
| 38  | No Pagination on Admin User List       | Admin  |
| 39  | No Analytics Event Tracking            | Web    |
| 40  | No Error Logging in Admin Frontend     | Admin  |
| 41  | No Stripe Connect Onboarding UI        | Web    |
| 42  | No Landing Page SEO Meta Tags          | Web    |
| 43  | No Social Share Images on Landing Page | Web    |
| 44  | No Contact/Support Page                | Web    |

### Testing (4)

| #   | Gap                                  | Module  |
| --- | ------------------------------------ | ------- |
| 45  | No Mutation Testing                  | Testing |
| 46  | No Performance Benchmark Tests       | Testing |
| 47  | No Accessibility Audit Tests         | Testing |
| 48  | No Load Testing for Webhook Endpoint | Testing |

### Compliance (2)

| #   | Gap                                | Module     |
| --- | ---------------------------------- | ---------- |
| 49  | No Deletion Confirmation Email     | Compliance |
| 50  | No Data Anonymization Verification | Compliance |

### Architecture (8)

| #   | Gap                                        | Module |
| --- | ------------------------------------------ | ------ |
| 51  | No API Versioning Strategy                 | API    |
| 52  | No Internal Service-to-Service Auth        | API    |
| 53  | No Rate Limit Configuration Documentation  | API    |
| 54  | No Connection Pool Metrics Exposed         | API    |
| 55  | No Request ID in Log Lines                 | API    |
| 56  | No Centralized Error Code Registry         | API    |
| 57  | No Health Check for Extension Dependencies | API    |
| 58  | No Circuit Breaker for External API Calls  | API    |

### Documentation (6)

| #   | Gap                               | Module |
| --- | --------------------------------- | ------ |
| 59  | No Architecture Overview Diagram  | Docs   |
| 60  | No Deployment Checklist           | Docs   |
| 61  | No Rollback Procedure Documented  | Docs   |
| 62  | No Incident Response Runbook      | Docs   |
| 63  | No Database ER Diagram            | Docs   |
| 64  | No Environment Variable Reference | Docs   |

### Developer Experience (6)

| #   | Gap                                          | Module |
| --- | -------------------------------------------- | ------ |
| 65  | No Docker Compose Profiles for Dev/Test      | DX     |
| 66  | No .vscode/ Workspace Settings               | DX     |
| 67  | No ESLint Plugin for Import Ordering         | DX     |
| 68  | No Prettier Config for Consistent Formatting | DX     |
| 69  | No Commit Message Convention                 | DX     |
| 70  | No Code Review Checklist                     | DX     |

---

## By-Module Breakdown

### API (`apps/api/`) — 48 gaps

- 12 critical, 28 medium, 8 low
- Key issues: Structured logging, error envelopes, Swagger, TOTP hardening, rate limiting, Prisma pool

### Web Frontend (`apps/web/`) — 32 gaps

- 8 critical, 18 medium, 6 low
- Key issues: 2FA UI, i18n, loading states, error boundaries, image optimization, noindex tags

### VS Code Extension (`apps/vscode-extension/`) — 5 gaps

- 2 critical, 3 medium
- Key issues: MFA login support, zero test coverage, no CI enforcement

### CLI (`apps/cli/`) — 4 gaps

- 1 critical, 2 medium, 1 low
- Key issues: Token file permissions, no auto-update, no retry logic

### DevOps (`Dockerfile`, `docker-compose.yml`, `.github/`) — 8 gaps

- 3 critical, 4 medium, 1 low
- Key issues: Docker readiness wait, CI timeout, no drift detection, no override config

### Database (`packages/db/`) — 5 gaps

- 0 critical, 3 medium, 2 low
- Key issues: No seed data, missing timestamps, missing migration documentation

### Config (`packages/config/`) — 3 gaps

- 0 critical, 2 medium, 1 low
- Key issues: Duplicate .refine() rules, key naming confusion

### Shared (`packages/shared/`) — 2 gaps

- 0 critical, 1 medium, 1 low
- Key issues: Contract gaps, missing twoFactorEnabled in user schema

---

## Recommended Action Plan

### Sprint 1: Security & Observability (9 critical gaps)

1. #114 — Add Swagger decorators to all DTOs and controllers
2. #106 — Implement structured JSON logging
3. #137 — Fix TOTP encryption key fallback in dev
4. #77 — Add TOTP 2FA support to VS Code extension login
5. #1 — Build 2FA settings UI (QR code, enable/disable)
6. #125 — Standardize API error response envelope
7. #84 — Add SameSite=Strict and __Host- prefix to auth cookies

### Sprint 2: Operations & Testing (8 critical gaps)

8. #78 — Add Postgres readiness wait in Docker entrypoint
9. #79 — Add VS Code extension tests to CI pipeline
10. #80 — Add Prisma schema drift detection to CI
11. #103 — Move Stripe webhook processing to background queue
12. #2 — Add load/stress testing framework
13. #3 — Write VS Code extension unit tests
14. #61 — Add audit log queue with retry/fallback
15. #44 — Add graceful shutdown handler

### Sprint 3: Frontend & UX (8 critical gaps)

16. #5 — Implement missing policy pages
17. #91 — Add route-specific error boundaries
18. #115 — Add Next.js Image optimization
19. #21 — Add CSP headers on API responses
20. #22 — Add CSRF protection
21. #62 — Add Redis to health check
22. #24 — Fix CLI credential file permissions
23. #23 — Add rate limiting to forgot-password endpoint

### Sprint 4-5: Remaining medium/low priority

27-158 — Remaining gaps across all categories
