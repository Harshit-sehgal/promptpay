# Security / Operational Audit Checklist

> **Status:** Updated 2026-07-12 after the fix pass described in `AGENTS.md`.
> All code-completable items below are implemented and verified by
> `pnpm typecheck`, `pnpm lint`, and `pnpm --filter waitlayer-api exec vitest run --no-file-parallelism`.

## ✅ Completed Fixes

| #   | Area      | Item                                                                                   | Evidence / Location                                                                                                              |
| --- | --------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cron      | Add overlap guards to `SessionCleanupCron`                                             | `apps/api/src/auth/session-cleanup.cron.ts` (`running` flag)                                                                     |
| 2   | Cron      | Add overlap guards to `LedgerCronService`                                              | `apps/api/src/ledger/ledger-cron.service.ts` (`running` flag)                                                                    |
| 3   | Cron      | Add overlap guards to `RetentionCronService`                                           | `apps/api/src/compliance/retention.cron.ts` (`running` flag)                                                                     |
| 4   | Audit     | Fix audit drain race condition                                                         | `apps/api/src/audit/audit.service.ts` (`drainPromise` serialization)                                                             |
| 5   | Cron      | Remove `MoneyIntegrityCronService` test-env skip                                       | `apps/api/src/admin/money-integrity.cron.ts`                                                                                     |
| 6   | API       | Add Prisma exception filter to prevent internal error leaks                            | `apps/api/src/common/filters/prisma-exception.filter.ts`, wired in `main.ts`                                                     |
| 7   | Extension | Implement extension version enforcement (`ToolIntegration.minVersion`)                 | `apps/api/src/extension/extension-device-report.trait.ts` (`assertMinimumExtensionVersion`)                                      |
| 8   | Audit     | Expand `AuditInterceptor` coverage beyond `/admin` and `/fraud` via `@Audit` decorator | `apps/api/src/common/interceptors/audit.interceptor.ts`; applied in payout, api-key, developer, advertiser, campaign controllers |
| 9   | Logging   | Add URL query-param redaction to `LoggingInterceptor`                                  | `apps/api/src/common/interceptors/logging.interceptor.ts` (`redactUrl`)                                                          |

## 🔄 Corrections from Previous Checklists

| #       | Was                                     | Corrected                                                                                         |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 5.1–5.3 | "No global rate limiting"               | **Global rate limiting exists** via `ThrottleByRouteGuard` (APP_GUARD) with Redis-backed storage. |
| 6.4     | "Email tokens not hashed in DB"         | **Tokens are stateless JWTs**, not DB-stored. No hashing needed.                                  |
| 10.1    | "Extension version enforcement missing" | Confirmed: `ToolIntegration.minVersion` is now enforced at device registration.                   |

## ✅ Completed Fixes (Batch 2 — CI/CD hygiene & package metadata)

| #   | Area             | Item                                        | Evidence / Location                                                                    |
| --- | ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 10  | CI               | Add `pnpm audit` to CI                      | `.github/workflows/ci.yml` — `Audit dependencies` step                                 |
| 11  | CI               | Docker CI health-checks web image           | `.github/workflows/ci.yml` — `Build + boot web and verify it serves over TCP`          |
| 12  | CI               | Typecheck/lint run in docker-build job      | `.github/workflows/ci.yml` — `Typecheck` and `Lint` steps in `docker-build`            |
| 13  | Package metadata | Consistent `engines` field across workspace | All `apps/*/package.json` and `packages/*/package.json` now declare `node: ">=22.0.0"` |

## ⏳ Remaining Open Items (require product/infra decisions or out-of-scope work)

### 1. CI/CD & Build Hygiene

| #   | Severity  | Item                                                        | Recommended Action                                |
| --- | --------- | ----------------------------------------------------------- | ------------------------------------------------- |
| 1.1 | 🔴 High   | Add `pnpm audit` or dependency vulnerability scanning to CI | ✅ Done                                           |
| 1.2 | 🟡 Medium | Docker CI only health-checks API, not web image             | ✅ Done                                           |
| 1.3 | 🟡 Medium | No lint/typecheck on compiled Docker image                  | ✅ Done                                           |
| 1.4 | 🟡 Medium | No e2e/browser tests in CI                                  | Add Playwright/Cypress browser smoke test         |
| 1.5 | 🟢 Low    | Dependabot config scope unverified for GitHub Actions       | ✅ Already configured in `.github/dependabot.yml` |
| 1.6 | 🟢 Low    | Some `package.json` files lack `engines` field              | ✅ Done                                           |

### 2. Database / Schema

| #   | Severity  | Item                                                                                | Recommended Action                     |
| --- | --------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| 2.1 | 🔴 High   | Monetary columns are still `Int` (2^31 cap), not `BigInt`                           | Migrate monetary columns to `BigInt`   |
| 2.2 | 🟡 Medium | Missing covering index on `earnings_ledger(userId, status, availableAt, createdAt)` | Add `createdAt` to covering index      |
| 2.3 | 🟡 Medium | Missing composite index on `ad_impressions(campaignId, qualifiedAt, isBillable)`    | Add reporting-friendly composite index |
| 2.4 | 🟢 Low    | Misleading comments about duplicate `@unique`/`@@index` storage                     | Clean up or remove stale comments      |
| 2.5 | 🟢 Low    | No partial indexes for common filtered queries                                      | Add partial indexes where appropriate  |

### 3. Operational Reliability

| #   | Severity  | Item                                            | Recommended Action                          |
| --- | --------- | ----------------------------------------------- | ------------------------------------------- |
| 3.1 | 🟡 Medium | No email queue/fallback for transactional email | Implement email queue with retry + fallback |
| 3.2 | 🟡 Medium | No backup/DR runbooks                           | Write backup and disaster-recovery runbooks |
| 3.3 | 🟢 Low    | Feature flags not implemented                   | Evaluate feature-flag solution              |

### 4. Strategic

| #   | Severity  | Item                    | Recommended Action                       |
| --- | --------- | ----------------------- | ---------------------------------------- |
| 4.1 | 🔴 High   | External security audit | Schedule third-party security audit      |
| 4.2 | 🟡 Medium | Cost/spend controls     | Add campaign spend guardrails and alerts |

## Verification Commands

```bash
pnpm typecheck
pnpm lint
pnpm --filter waitlayer-api exec vitest run --no-file-parallelism
```

Last verified: 2026-07-12 — all green.
