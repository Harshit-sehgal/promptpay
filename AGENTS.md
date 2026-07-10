# Agent Instructions and Current Code Audit

This file applies to the whole repository. It is auto-loaded so AI coding agents
see the live risk/status register without being told to read a separate doc.

> **Pruned 2026-07-10.** All issues A-001…A-081 were code-verified against the
> actual source (four parallel read-only audits: A-001–A-027, A-028–A-059,
> A-055–A-081, plus a docs audit). Every resolved claim held; no code
> contradiction was found. The detailed per-item writeups were removed. This file
> now carries only the **open / unverified** items plus a compact verified
> resolved index for traceability. Durable counts are intentionally not
> hard-coded — re-run the quality gates below for live totals.

## Operating Rules for Agents

- Treat the current codebase as authoritative. Older docs, README status claims,
  roadmaps, and checklists may be stale.
- Before fixing an open item, re-inspect the relevant files — paths below are
  evidence pointers; line numbers and implementation details can drift.
- Separate audit fixes from unrelated edits; do not overwrite user work.
- Keep this file current: when an item is fixed, move it to the resolved index
  with the date and the verification command/manual test that proves it.
- Do not mark an item complete just because a narrow unit test passes.

## Current Status (snapshot 2026-07-10)

- **All issues A-001…A-081 are resolved and code-verified.** The only remaining
  items are non-code: one operator decision (A-030), two verification/infra gaps
  (A-033 live claims, A-075 Docker build e2e), and a set of code-complete items
  whose browser/live E2E is still pending.
- This is a snapshot. Re-run the gates before declaring the repo healthy.

### Quality gates (run from repo root)

```bash
pnpm --filter @waitlayer/db generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For database-backed suites, Postgres + Redis must be available and the test DB
migrated/reset. Authoritative API result (integration tests share one Postgres):

```bash
pnpm --filter waitlayer-api exec vitest run --no-file-parallelism
```

## Open Items (not code-completable / unverified)

### A-030 — Payout provider launch availability (operator decision)

- **Code state (verified):** `apps/web/src/lib/payout-providers.ts:19-50` marks
  all five providers (`paypal_email`, `manual`, `paypal_payouts`, `stripe_connect`,
  `wise`) `status: 'available'`. Provider implementations exist in
  `apps/api/src/payout/providers/`.
- **Gap:** which _automated_ rails (PayPal Payouts / Stripe Connect / Wise) are
  actually enabled at the provider-account level is an operator launch decision,
  not a code change. `FOUNDATION_STATUS.md` domain 7 still lists payouts as
  "Partial" (Razorpay/Payoneer stubs blocked in prod) — consistent with this.

### A-033 — Landing "Live" tool claims (runtime verification)

- **Code state (verified):** `apps/web/src/app/comparison/page.tsx:37-51` marks
  six tools `live` (VS Code, Cursor, Windsurf, Cline, Claude Code, Terminal) over
  **two** real codebases: `vscode-extension` (Cursor/Windsurf/Cline) and `cli`
  (Claude Code/Terminal). `aider`/`codex-cli` are `planned`. The file's own
  comment documents this.
- **Gap:** no automated per-tool "Live" runtime test. Requires running packaged
  CLI + VS Code clients against a live environment.

### A-075 — Docker non-root runtime (build not run end-to-end)

- **Code state (verified):** `Dockerfile:50-51` (api) and `Dockerfile:79-80`
  (web) both do `RUN chown -R node:node /app` then `USER node`. HEALTHCHECK hits
  `/health/ready` (api, line 56) and `/` (web, line 85).
- **Gap:** a full `docker build` never completed — `pnpm install
--frozen-lockfile` timed out on registry access. Needs network/registry, not
  code.

## 2026-07-10 Source Audit — gap closures

The 2026-07-10 source audit verified `AGENTS.md` against the actual code.
`waitlayer-gap-analysis.md` is **historical** — its note listing A-074…A-081 as
OPEN is stale/false; those items are code-DONE. The following previously-mis-closed
gaps are now **code-closed**:

- #23 / #63 — 2FA endpoints (`/auth/2fa/*`) now use the tight `auth-short` (10/min) throttle bucket.
- #31 — CLI HTTP client retries transient failures (socket errors, timeouts, 429/5xx) with capped exponential backoff.
- #79 — CI now runs the VS Code extension test (`pnpm --filter waitlayer-vscode test`).
- #82 — CI jobs have `timeout-minutes: 30`.

Gaps still requiring a product/legal/infra decision (not closable by a source edit):
#12 age verification (self-asserted 18+ only), #39 analytics (no vendor chosen),
#103 webhook async processing (set `WEBHOOK_ASYNC_PROCESSING=true` in prod),
#131 message broker (in-process EventBus only).

## Residual Verification (code complete; browser/live E2E pending)

These are shipped and unit/integration-tested; their "Done when" still lists a
browser or live-client check that has not been executed:

- **A-018** Google sign-in CSP: `apps/web/next.config.js:39` adds
  `frame-src 'self' https://accounts.google.com`; live browser render + ID-token
  callback unverified.
- **A-027** CLI/extension consuming an admin-issued device recovery token:
  server issuance is unit-tested (`admin.service.spec.ts`); live client
  consumption unverified (no public consume route exists by design).
- **A-036** CCPA opt-out: enforced in ad selection
  (`extension.service.ts:628-639`); legal scope _outside_ ad serving
  (reporting/exports/audience) is undefined by product.
- **A-040** CLI `waitlayer watch` money loop: covered via HTTP E2E against the
  same API surface; live compiled-binary run not done.
- **A-046** Fraud recompute: shared client wired; no UI test proving a 500 leaves
  a visible error.
- **A-047** Consent version fail-closed: code verified; browser E2E for
  signup/re-prompt/cookie paths pending.
- **A-050 / A-067** date-range end-day inclusion + reports CTR×100 / "1 day"
  preset: code done; explicit API tests for end-day inclusion flagged.
- **A-056** Country targeting enforced server-side; VS Code/CLI don't actively
  send `country` (fall back to profile country) — live population smoke pending.

## Verified Resolved Index (A-001…A-081, code-verified 2026-07-10)

Each line: `A-0XX — what — verification evidence (file:line)`. Full detailed
writeups were pruned; this index preserves the audit trail.

- A-001 root build/Docker — web deps (`@tailwindcss/postcss`, `zod`) + cli `auth.test.ts` fix; `pnpm build` 9/9.
- A-002 auth cookies — bare names, secure `__Host-` only (`cookies.ts:25-41`, `readAuthCookie:52-57`).
- A-003 advertiser reports `$queryRaw` mock (`advertiser.service.spec.ts:40,174,200`).
- A-004 proxy allowlist `/developer/delete-account` (`route.ts` ALLOWED_PATH_PREFIXES).
- A-005 route-aware secret scrub (`route.ts` `allowSetupSecret` `/auth/2fa/setup`).
- A-006 web auth/proxy tests (`cookies/middleware/proxy/services.*.spec`).
- A-007 admin `getMetrics` `$queryRaw date_trunc` (`admin.service.ts:1326,1340-1431`).
- A-008 ledger dev role+scope guards (`ledger.controller.ts`).
- A-009 anonymous consent nullable `userId` + `visitorIdHash` + migration + controller (`schema.prisma:1121+`, `compliance.service.ts:66-110`).
- A-010 README no hard counts (FOUNDATION_STATUS count fixed separately).
- A-011 worktree committed (`git status` clean).
- A-012 migration gate (`main.ts:96 verifyMigrationsApplied`; `ci.yml:55-57`).
- A-013 prod API defaults (`api-client.ts:18-30`; vscode `package.json:84`).
- A-014 ledger-only API key (`api-key.dto` `UNSUPPORTED_SCOPES`; `createLedgerApiKey` posts `ledger:read`).
- A-015 email verify resend (`auth.controller:134`; settings/payouts pages).
  - A-016 middleware `JWT_SECRET` tests (`middleware.test.ts:27`; `lib/web-env.ts:21`).
- A-017 `ConfigModule` `loadEnv` wired (`app.module.ts:43`).
- A-018 CSP `frame-src` google (`next.config.js:39`).
- A-019 deposit auto-activates approved campaign (`stripe-webhook.controller:429-456`).
- A-020 campaign pause/resume UI (`campaign-actions.ts:24-30`).
- A-021 campaign edit/archive/rejection reasons (`services.ts:95`; page.tsx).
- A-022 VS Code CTA text (`extension.ts:121`; `ad-display.ts` fallback).
  - A-023 deposit banner (`advertiser/page.tsx:115` — success/cancelled states; no separate pending copy).
- A-024 CTR ratio render ×100 (`advertiser.service.ts:409`; `page.tsx:169`) — _index pointer corrected from stale `:276`._
- A-025 admin users shape (`admin.service.ts:296-330`; `users/page.tsx:161-192`).
- A-026 payout amount units (`admin/payouts/amounts.ts:6-8`; `amounts.test.ts`).
- A-027 device recovery issuance (`admin.controller:184,190`; `devices/page.tsx`).
- A-028 admin user lifecycle buttons (`admin/users/page.tsx:250-319`).
- A-029 feedback backend submit (`feedback/page.tsx:20`; `feedback.service.ts`).
- A-030 all 5 payout providers `available` (`payout-providers.ts:19-50`) — operator launch decision remains.
  - A-031 currency helpers in UI (relocated to `@waitlayer/shared`: `formatMinorUnits`, `minorToMajorInputValue`, `depositMinimumMinor`, `payoutMinimumMinor`; developer payouts `page.tsx:342-351`).
- A-032 reports pagination bounds (`advertiser.service.ts:42-43`; `spec:237-295`).
- A-033 comparison `Live` claims over 2 codebases (`comparison/page.tsx:37-51`) — runtime unverified.
- A-034 signup consent DTO+tx (`signup.dto.ts:43-51`; `auth.service.ts:94-97,110-172`).
- A-035 payout 2FA policy (`payout.service.ts:354,622`; `security/page.tsx:37`).
- A-036 CCPA opt-out in ad select (`extension.service.ts:628-639`; `privacy/page.tsx:67-75`).
- A-037 `RejectApiKeyGuard` on advertiser export/delete (`advertiser.controller:305-317`).
- A-038 ad cache keyed by user/device (`extension.service.ts:721-722`).
- A-039 per-currency balance (`extension.service.ts:818-821`; `advertiser-balance.ts`).
- A-040 CLI ad flow (`watch.ts` `runAdFlow`; `ad-flow.ts` `MIN_DURATION 5000`).
- A-041 referral reward earnings (`referral.service.ts:197-262`).
- A-042 readiness 503 (`health.controller.ts:56-84`).
- A-043 CLI packaging/shebang (`package.json` bin; `verify-cli-bin.mjs`; no `@waitlayer/shared`).
- A-044 advertiser privacy UI (`advertiser.controller:305-317`; `settings/page.tsx`).
- A-045 empty creative reject reason (`campaign.service.ts:219-233`).
- A-046 fraud recompute client (`admin.controller:153-155`; `fraud/page.tsx:217-229`).
- A-047 consent version fail-closed (`consent-versions.ts:5-9`; `cookie-consent.tsx:58-85`).
- A-048 payout `isVerified` gate (`schema.prisma:368`; `payout.service.ts:681`; admin verify).
- A-049 logout waits server (`logout/route.ts:32-53`; `auth-context.tsx:150-155`).
- A-050 date-only end-day (`advertiser.service.ts` `buildReportsDateFilter:104-126`).
- A-051 campaign draft recovery (`new/page.tsx:96,113,150-188`).
- A-052 role CTAs (`auth-routing.ts:21-38`; pages use `?role=`).
- A-053 redis health recovery (`redis-health.service.ts:32-88`).
- A-054 archive refund balance (`advertiser-balance.ts`; A-066 residual on `getBilling`).
- A-055 concurrency advisory lock (`extension.service.ts:63,989-995`) — mock-based spec.
- A-056 country targeting (`extension.service.ts:706-797`; `campaign.service:255`).
- A-057 blocked categories (`extension.service.ts:703-704,791`; `schema:349`; slug validation).
- A-058 quiet mode timezone (`schema:345`; `extension.service.ts:1844` `Intl`).
- A-059 partial payout remainder (`payout.service.ts` `requestPayout→allocatePayoutEarnings:424-541`) — _method name corrected from stale `processPayout()`._
- A-060 min visible duration server-side (`extension.service.ts:1090,1169-1177`).
- A-061 frequency caps enforced (`extension.service.ts:741-752,801-806,1018-1024`).
- A-062 webhook reclaim cron (`webhook-reclaim-cron.service.ts`; `payout.module.ts:24`).
- A-063 partial dispute hold/restore (`stripe-webhook.controller:657,892-960`).
- A-064 CLI single sessionId (`watch.ts:111-136`).
- A-065 CLI signup consent (`auth.ts:132-178`).
- A-066 billing refund formula (`advertiser.service.ts:504,549-554,573`).
- A-067 reports CTR×100 + "1 day" (`reports/page.tsx:59,272,380,424`; `reports-csv.ts:32,49`).
- A-068 daily trend `$queryRaw` (`advertiser.service.ts:1121-1147`).
- A-069 `AdminDevicesQueryDto` + proxy query (`admin/dto/index.ts:2`; `route.ts:166`).
- A-070 rejected sensitive scopes (`api-key.dto:25-29`; `payout.controller` `RejectApiKeyGuard`).
- A-071 bounded payout balance (`developer.service` `getEarningsSummary:85-89`; `payout.service:359-409`).
- A-072 capped exports (`developer.service:385-412`; `export-metadata.ts`).
- A-073 frequency-cap edit UI (`frequency-caps.ts:7-33`).
- A-074 dashboard/list/edit pagination (`advertiser.service:52,360,423,468`).
- A-075 Docker `USER node` (`Dockerfile:50-51,79-80`) — full build e2e not run.
- A-076 money-integrity bounded (`admin.service.ts:69-294`).
- A-077 admin campaign queue pagination (`admin.service.ts:390-409`).
- A-078 feedback message persisted (`feedback.service.ts:47-54`; `page.tsx:38`).
- A-079 local QR (`developer/settings/page.tsx:5,171` `qrcode` toDataURL; no `googleapis`).
- A-080 shared currency constants (`payout-policy/page.tsx:4,13,14`; `pricing/page.tsx:4,56,57`).
- A-081 non-USD deposit currency (`new/page.tsx:40-67,220-233`).

## End-to-End SaaS Readiness Checks

The three flows (developer / advertiser / admin) are code-complete step by step.
**The integrated readiness pass has NOT been run against a fresh, migrated,
production-like environment.** Open blockers for SaaS readiness: A-030, A-033,
A-075, and the residual browser/live E2E listed above.

Required verification before calling the repo healthy — re-run from a clean
checkout with Postgres + Redis:

```bash
pnpm --filter @waitlayer/db generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Plus manual/integration checks called out in the individual open/residual items
above (login/signup/logout middleware, TOTP local QR, Stripe webhook on migrated
DB, large synthetic report/balance/admin data, packaged CLI/VS Code defaults,
non-root Docker images, ledger role/scopes, payout/deposit thresholds vs shared
policy, non-USD deposit→campaign→spend, feedback success/failure paths,
logged-out/in consent).
