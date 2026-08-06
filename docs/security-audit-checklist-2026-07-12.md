# Security / Operational Audit Checklist

> **Status:** Reconciled 2026-08-06 against the live source. Historical dates
> and claims below are retained for traceability; the current repository and
> current quality-gate outputs are authoritative.

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
| 1.4 | 🟡 Medium | No e2e/browser tests in CI                                  | ✅ Done in `.github/workflows/ci.yml` (`e2e`)     |
| 1.5 | 🟢 Low    | Dependabot config scope unverified for GitHub Actions       | ✅ Already configured in `.github/dependabot.yml` |
| 1.6 | 🟢 Low    | Some `package.json` files lack `engines` field              | ✅ Done                                           |

### 2. Database / Schema

| #   | Severity  | Item                                                                                | Recommended Action                        |
| --- | --------- | ----------------------------------------------------------------------------------- | ----------------------------------------- |
| 2.1 | 🔴 High   | Monetary columns are still `Int` (2^31 cap), not `BigInt`                           | ✅ Current money fields use `BigInt`      |
| 2.2 | 🟡 Medium | Missing covering index on `earnings_ledger(userId, status, availableAt, createdAt)` | ✅ Added in migration `20260806040000`    |
| 2.3 | 🟡 Medium | Missing composite index on `ad_impressions(campaignId, qualifiedAt, isBillable)`    | ✅ Added in migration `20260806040000`    |
| 2.4 | 🟢 Low    | Misleading comments about duplicate `@unique`/`@@index` storage                     | ✅ Current schema comments are reviewed   |
| 2.5 | 🟢 Low    | No partial indexes for common filtered queries                                      | Deferred; query-plan evidence is required |

### 3. Operational Reliability

| #   | Severity  | Item                                            | Recommended Action                                               |
| --- | --------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| 3.1 | 🟡 Medium | No email queue/fallback for transactional email | ✅ Email queue, retry, poison handling, and fallback exist       |
| 3.2 | 🟡 Medium | No backup/DR runbooks                           | ✅ Implemented in `docs/16-operational-runbooks.md` and CI drill |
| 3.3 | 🟢 Low    | Feature flags not implemented                   | ✅ Runtime switches/configuration are implemented                |

### 4. Strategic

| #   | Severity  | Item                    | Recommended Action                                          |
| --- | --------- | ----------------------- | ----------------------------------------------------------- |
| 4.1 | 🔴 High   | External security audit | Schedule third-party security audit                         |
| 4.2 | 🟡 Medium | Cost/spend controls     | ✅ Atomic budget guards, caps, alerts, and spend cron exist |

## Verification Commands

```bash
pnpm typecheck
pnpm lint
pnpm --filter waitlayer-api exec vitest run --no-file-parallelism
```

Last reconciled: 2026-08-06. Current schema validation, migration status, and
the repository quality gates are recorded in `AGENTS.md` and the release
backlog; external security review remains open.
