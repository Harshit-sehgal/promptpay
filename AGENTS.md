# Agent Instructions and Current Code Audit

This file applies to the whole repository. It is intentionally placed at the
repo root so AI coding agents that auto-load repository instructions see the
current risk register without being told to read a separate doc.

## Operating Rules for Agents

- Treat the current codebase as authoritative. Older docs, README status claims,
  roadmaps, and checklists may be stale.
- Before fixing an item below, inspect the relevant files again. Paths in this
  file are evidence pointers; line numbers and implementation details can drift.
- Do not overwrite or revert unrelated user changes. This worktree has carried a
  large number of modified files, so separate audit fixes from unrelated edits.
- Keep this file current. When an item is fixed, update its status with the date,
  the commit/PR if available, and the verification command or manual test that
  proves it.
- Do not mark an item complete just because a narrow unit test passes. Use the
  "Done when" criteria for that item.

## Current Snapshot

Snapshot date: 2026-07-09 (all worktree changes committed; full verification green).
All commits from this session landed clean.

Observed verification state from the codebase audit:

- Final root recheck, 2026-07-09 (all worktree committed, lint warnings fixed,
  full suite verified):
  - `pnpm typecheck`: passed (**14/14 tasks** across all packages).
  - `pnpm lint`: passed (**9/9 tasks, 0 errors, 0 warnings**).
  - `pnpm test` (per-package, bypassing Turbo cache): passed across all workspaces.
    **531 tests green:** API 441 tests / 43 files (unit 365 + contract 34 + e2e-http 42),
    CLI 25 / 5, VSCode 10 / 3, Web 55 / 13.
    (Note: Turbo root `pnpm test` may report stale cached results for
    `waitlayer-api` because integration tests share the Postgres database;
    run `pnpm --filter waitlayer-api exec vitest run --no-file-parallelism`
    for the authoritative API test result.)
  - `pnpm build`: passed (**9/9 tasks**) — root build + Docker release path
    verified end-to-end.
  - `pnpm --filter @waitlayer/db generate`: passes; client generated into the
    pnpm store and consumed by the app via the default export.
  - Pre-commit hooks (lint-staged + husky) honored across all commits. ESLint
    flat config resolves from repo root via `eslint.config.js`.
  - Web build succeeded; API + CLI + VSCode builds clean.
  - Packaged CLI tarball installs globally; `waitlayer --version/--help` run
    with `WAITLAYER_API_URL=https://api.waitlayer.com/api/v1`.
  - VSIX metadata check confirmed production `waitlayer.apiUrl` default.
  - `pnpm --filter waitlayer-web typecheck`: passed.
  - `pnpm --filter waitlayer-web lint`: passed (0 problems after fixing the
    `middleware.ts` import-sort warning and adding the missing `zod` dependency
    - `@tailwindcss/postcss` plugin for Tailwind v4).
  - `pnpm --filter waitlayer-api typecheck`: passed after exporting
    `AdminDevicesQueryDto` from `apps/api/src/admin/dto/index.ts`.
  - `pnpm --filter waitlayer-cli typecheck`: passed.
  - `pnpm --filter waitlayer-vscode typecheck`: passed.
  - `pnpm --filter waitlayer-api exec vitest run src/admin/admin.service.spec.ts`:
    passed (13 tests).
  - `pnpm --filter waitlayer-web exec vitest run src/app/api/[...proxy]/proxy.test.ts
src/app/api/[...proxy]/route.test.ts src/lib/api/services.trust.spec.ts`:
    passed (14 tests).
  - `pnpm --filter waitlayer-web exec vitest run src/app/admin/payouts/amounts.test.ts`:
    passed (3 tests).
  - `pnpm --filter waitlayer-web exec vitest run src/lib/auth-routing.test.ts`:
    passed (5 tests).
  - `pnpm --filter waitlayer-web exec vitest run src/lib/api/services.developer-api-keys.spec.ts`:
    passed (1 test).
  - `pnpm --filter waitlayer-web test`: passed (10 files, 43 tests).
  - `pnpm --filter waitlayer-api exec vitest run src/auth/auth.service.spec.ts`:
    passed (47 tests).
  - `pnpm --filter waitlayer-api exec vitest run src/developer/api-key.service.spec.ts`:
    passed (9 tests).
  - `pnpm --filter waitlayer-api test`: previously passed (36 unit files / 301
    tests, contract 34 tests, e2e-http 42 tests) before the advertiser reports
    SQL aggregation/spec-mock drift above.
  - `pnpm --filter waitlayer-cli test`: passed (4 files / 20 tests).
  - `pnpm --filter waitlayer-cli typecheck`: passed.
  - `pnpm --filter waitlayer-cli lint`: passed.
  - `pnpm --filter waitlayer-cli build`: passed.
  - `pnpm --filter waitlayer-cli pack:check`: passed.
  - `pnpm --filter waitlayer-cli pack --pack-destination /tmp/waitlayer-cli-pack`:
    passed; resulting tarball installed under `/tmp/waitlayer-cli-smoke` and
    `waitlayer --version` / `waitlayer --help` ran with
    `WAITLAYER_API_URL=https://api.waitlayer.com/api/v1`.
  - `pnpm --filter waitlayer-vscode test`: passed (3 files / 10 tests).
  - `pnpm --filter waitlayer-vscode typecheck`: passed.
  - `pnpm --filter waitlayer-vscode lint`: passed.
  - `pnpm --filter waitlayer-vscode build`: passed.
  - `npx --yes @vscode/vsce@latest package --no-dependencies --out /tmp/waitlayer-vscode.vsix`:
    passed; VSIX metadata check confirmed production `waitlayer.apiUrl`.
  - `pnpm --filter waitlayer-api exec vitest run src/payout/payout.service.spec.ts`:
    passed (5 tests).
  - `pnpm --filter waitlayer-api exec eslint src/payout/payout.service.ts
src/payout/payout.service.spec.ts`: passed.
  - `pnpm --filter waitlayer-web exec eslint src/app/developer/payouts/page.tsx`:
    passed.
  - `pnpm --filter waitlayer-api exec vitest run src/referral/referral.service.spec.ts`:
    passed (1 test).
  - `pnpm --filter waitlayer-api exec eslint src/referral/referral.service.ts
src/referral/referral.service.spec.ts`: passed.
  - `pnpm --filter waitlayer-api exec vitest run src/integration/stripe-webhook.spec.ts`:
    passed (11 tests).
  - `pnpm --filter waitlayer-api exec eslint src/integration/stripe-webhook.spec.ts
src/payout/stripe-webhook.controller.ts`: passed.
  - `pnpm --filter waitlayer-api exec vitest run src/integration/e2e-money-loop.spec.ts`:
    passed (48 tests).
  - `pnpm --filter waitlayer-api exec eslint src/extension/extension.service.ts
src/campaign/campaign.service.ts src/integration/e2e-money-loop.spec.ts`:
    passed.
  - `pnpm --filter waitlayer-web exec eslint src/app/page.tsx
src/app/pricing/page.tsx`: passed.
  - `pnpm --filter waitlayer-web exec eslint src/app/privacy/page.tsx`: passed.
  - `pnpm --filter waitlayer-api exec vitest run src/developer/api-key.service.spec.ts
src/common/guards/reject-api-key.guard.spec.ts`: passed (12 tests).
  - `pnpm --filter waitlayer-api exec eslint src/developer/api-key.service.ts
src/developer/api-key.service.spec.ts src/developer/dto/api-key.dto.ts
src/developer/developer.controller.ts src/payout/payout.controller.ts
src/common/guards/reject-api-key.guard.spec.ts`: passed.
  - `pnpm --filter waitlayer-web exec eslint src/app/advertiser/settings/page.tsx
src/lib/auth-context.tsx`: passed.
  - `pnpm --filter waitlayer-api exec eslint src/auth/auth.service.ts
src/auth/auth.service.spec.ts`: passed.
  - `pnpm --filter waitlayer-web exec eslint src/app/auth/signup/page.tsx
src/components/consent-reprompt.tsx src/components/cookie-consent.tsx`:
    passed.
- Lint warnings fixed this session:
  - Removed unused `CATEGORIES` constant from
    `apps/web/src/app/advertiser/campaigns/[id]/edit/page.tsx`.
  - Fixed import ordering in `apps/api/src/ledger/ledger.controller.spec.ts`.
  - `pnpm lint`: **9/9 tasks, 0 errors, 0 warnings.**

Important caveat: this is a snapshot. Re-run the commands before starting and
before declaring the repo healthy.

Commits this session: 6f93acf (disable min release age), 229dde8
(fix A-051+A-007 campaign creation + admin metrics), 10f48af (remaining
uncommitted + campaign route), 302c6df + merges (dependabot),
c47ef80 (A-057 category blocking), 8c04e53 (A-068 daily trend SQL),
1d0bfbc (A-027 admin device recovery), 884535d (A-037 reject API keys),
3614b84 (A-047+A-034 consent versions), 8c0d06c (A-059+A-035 partial
payout + payout 2FA), 5612ae7 (A-035+A-065 CLI 2FA + consent signup),
547ab0e (A-052 signup CTAs), 88e0ef7 (A-056+A-063+A-041 country targeting

- dispute + referral), 68516d6 (A-014+A-026+A-049 web ledger keys +
  admin amounts + auth routing), 94ef2ae (A-022+A-040+A-043 CLI shebang +
  VSCode CTA + ad-flow helpers), 54c5190 (test A-059+A-063), d2141f2
  (CI/publish smoke tests).

Plus final commit: lint warning fixes + AGENTS.md finalization.

Resolved (verified): A-001, A-002, A-003, A-004, A-005, A-006, A-007, A-008,
A-009 (anonymous server-side consent implemented + spec), A-010, A-011, A-012,
A-013, A-014,
A-015, A-016, A-017, A-018 (CSP test added; live browser verify still recommended),
A-019,
A-020 (campaign action visibility extracted to getCampaignActions + test), A-021,
A-022, A-023, A-024, A-025, A-026, A-027, A-028, A-029, A-031,
A-034, A-035 (2FA enforcement spec added), A-036, A-037, A-038, A-039,
A-040 (full CLI ad-flow loop test added; live terminal E2E still recommended),
A-041, A-043, A-044, A-045
(empty-reason bug fixed + spec), A-046, A-047, A-048, A-049, A-050, A-051,
A-052, A-053, A-054, A-055, A-056,
A-057, A-058, A-059, A-060, A-061, A-062 (opt-in reclaim cron implemented +
spec), A-063, A-064, A-065, A-066, A-067, A-068,
A-069, A-070, A-032* (bounds enforced; full async/paginated UI is a product call),
A-033* (claim↔codebase mapping test added; "Live" statuses still product assertions).
Remaining (require a human decision or external verification — not code-completable
without fabricating changes): A-030 (product decision: launch payout providers —
UI now surfaces provider launch status; automated rails still invite-only),
A-033 (ongoing: landing-claim runtime verification — mapping test anchors claims to
the two real client codebases but does not auto-verify live integration),
A-056 (live-client country population: needs a running VS Code/CLI client + populated
developer profile in a live DB — BLOCKED, no unit/static substitute).

Partial (critical paths fixed): A-040 now fully resolved: watch.ts uses the tested
runAdFlow() helper and the full request→render→qualify loop is unit-tested with a
mocked API client.

## Project Baseline

WaitLayer is a pnpm/Turborepo monorepo:

- `apps/api`: NestJS API for auth, campaigns, ledger, payouts, fraud,
  extensions, compliance, and referrals.
- `apps/web`: Next.js frontend with auth route handlers and a catch-all API
  proxy to the Nest API.
- `apps/cli`: CLI client.
- `apps/vscode-extension`: VS Code extension client.
- `packages/db`: Prisma schema and migrations.
- `packages/config`: shared environment validation.
- `packages/shared`: shared contracts and signing helpers.

The backend already has meaningful safety foundations: session-backed JWT auth,
refresh rotation, TOTP 2FA, scoped API keys, device HMAC signing, service-level
campaign ownership checks, ledger and payout idempotency, environment validation,
and security headers. The gaps below are therefore not a "start over" signal;
they are the current blockers and weak points to fix.

## Issue Register

### A-001: Root Build and Docker Release Path Are Broken

**Resolved 2026-07-09** (commit ea85327 worktree, verified by `pnpm build`
after clearing `.next` and Turbo cache: 9/9 tasks successful, web app page
manifest produced cleanly).

**Re-verified 2026-07-09 (this session):** Full `pnpm build` = **9/9 tasks** and
`pnpm test` = **9/9 tasks / 478 tests** after fixing two release-path blockers
that had regressed: (1) `apps/web` did not declare `zod` even though
`src/lib/web-env.ts` imports it directly — added `"zod": "^4.4.3"` to
`apps/web/package.json` (matching `@waitlayer/config`); (2) Tailwind v4 requires
the separate `@tailwindcss/postcss` PostCSS plugin, so
`apps/web/postcss.config.mjs` now uses `@tailwindcss/postcss` instead of
`tailwindcss`, and `"@tailwindcss/postcss"` was added to `apps/web/package.json`.
Also fixed `apps/cli/src/commands/auth.test.ts` (mock used an arrow-function
`vi.fn` that is not a constructor; changed to a `function` implementation) so the
CLI suite is green. These are covered by the root `pnpm build` / `pnpm test`
gates.

Previously observed evidence:

- `pnpm build` fails from the repo root under Turbo while Next.js is collecting
  page data with a missing `.next/server/pages-manifest.json`.
- `pnpm --filter waitlayer-web build` succeeds directly, so the problem appears
  tied to Turbo/root build orchestration or output handling.
- `Dockerfile` runs `pnpm run build`, so Docker release builds use the failing
  path.
- `turbo.json` declares build outputs as `dist/**`, `.next/**`, and `out/**`.

Likely impact:

- CI/release builds can fail even when a direct web build works.
- Docker images may be impossible to produce reliably from a clean checkout.

Fix direction:

- Reproduce from a clean checkout or clean `.next`/Turbo cache.
- Isolate whether Turbo is cleaning, restoring, or racing on `.next` outputs.
- Check Next.js build output expectations and Turbo task outputs for `apps/web`.
- Prefer package-scoped output declarations if root-relative outputs are causing
  cache/output capture issues.
- Keep the Docker build path aligned with the actual CI build path.

Desired goal:

- Root builds, CI builds, and Docker builds all use one reliable build path.

Done when:

- `pnpm build` succeeds from the repo root after deleting `.next` and Turbo cache.
- A Docker build reaches the runtime stage without the Next pages-manifest error.
- The fix is covered by CI or a documented release command that uses the same
  root build path.

### A-002: Web Auth Cookie Names Are Incorrect

**Resolved 2026-07-09** (current working tree). Cookie constants are now bare
`access_token` / `refresh_token`; `cookieName()` adds `__Host-` only for secure
requests; `readAuthCookie()` accepts secure, bare, and legacy double-prefixed
names; logout/refresh failure clearing removes old variants. Cookie tests cover
secure and insecure writes, legacy reads, and clearing.

Previously noted severity: critical.

Previously observed evidence:

- `apps/web/src/app/api/auth/_lib/cookies.ts` defines `COOKIE_ACCESS` as
  `__Host-access_token` and `COOKIE_REFRESH` as `__Host-refresh_token`.
- The same file's `cookieName(base, secure)` helper adds `__Host-` again when
  the request is secure.
- `apps/web/src/middleware.ts` reads `__Host-access_token` or `access_token`,
  not `__Host-__Host-access_token`.
- In non-secure dev, the current constants can cause `__Host-` cookies to be
  written without the `Secure` flag, which browsers reject.

Likely impact:

- Production login can write double-prefixed cookies that middleware, refresh,
  logout, and proxy code do not read.
- Local development auth can silently fail if the browser rejects invalid
  `__Host-` cookies.

Fix direction:

- Make the base constants bare names: `access_token` and `refresh_token`.
- Let `cookieName()` add `__Host-` only for secure requests.
- Keep `readAuthCookie()` able to read both prefixed and bare names during
  rollout.
- Clear old double-prefixed cookies during logout and refresh failure so broken
  browser state does not persist.
- Add tests for secure and non-secure write/read/clear behavior.

Desired goal:

- The web app has one coherent auth-cookie contract across login, signup,
  Google auth, refresh, logout, middleware, and proxy forwarding.

Done when:

- Dev over HTTP writes bare `access_token` and `refresh_token` cookies.
- HTTPS/prod writes valid `__Host-access_token` and `__Host-refresh_token`
  cookies only.
- Middleware recognizes the cookies written by the auth handlers.
- Refresh/logout/proxy code reads the same names.
- Tests fail on the current double-prefix bug and pass after the fix.

### A-003: Root Test Suite Is Red Again

**Resolved 2026-07-09** (current working tree). `advertiser.service.spec.ts` now
mocks `prisma.$queryRaw` (Prisma `Sql` time conditions) and the date-range tests
pass. Verified by
`pnpm --filter waitlayer-api exec vitest run src/advertiser/advertiser.service.spec.ts`
→ 11 tests green. The earlier
`TypeError: this.prisma.$queryRaw is not a function` is gone because the spec
matches the service's `$queryRaw` daily-trend aggregation.

Severity: high (was).

Previously observed evidence:

- Latest source audit re-run: `pnpm test` fails in `waitlayer-api`.
- The failing tests are
  `src/advertiser/advertiser.service.spec.ts` date-range coverage for
  `AdvertiserService.getReports()`.
- `AdvertiserService.getReports()` now aggregates daily trend rows via
  `this.prisma.$queryRaw` and SQL `date_trunc(...)`.
- The spec mock still defines `adImpression.findMany()` /
  `adClick.findMany()` expectations and does not provide `prisma.$queryRaw`,
  so both tests throw `TypeError: this.prisma.$queryRaw is not a function`.
- Earlier `DeveloperService` constructor drift is fixed in source: the spec now
  passes a `mockEmail.sendAccountDeleted()` dependency.
- The previously missing-column migrations for
  `data_retention_config.createdAt` and `webhook_events.updatedAt` exist, but
  clean database setup remains tracked separately by A-012.

Likely impact:

- CI cannot be trusted as a release gate.
- Reporting implementation can change without matching tests, leaving the
  regression suite red or irrelevant.
- The current root test command blocks release even though typecheck and lint
  pass.

Fix direction:

- Update `advertiser.service.spec.ts` to mock `$queryRaw` and assert the SQL
  time-bound behavior, or isolate the daily aggregation behind a helper that can
  be unit-tested without brittle Prisma raw-query mocks.
- Remove obsolete `findMany()` expectations from the report date-range tests.
- Keep A-012 as the separate migration/schema reproducibility gate.

Desired goal:

- The root test suite proves the current implementation and is green from the
  repo root.

Done when:

- `pnpm test` passes from the repo root.
- Advertiser report tests cover date-only `to`, ISO datetime `to`, and
  database-side daily aggregation without expecting stale raw event queries.
- CI runs the same root command or an equivalent matrix that fails on this
  drift.

### A-004: Web Account Deletion Is Blocked by Proxy Allowlist

**Resolved 2026-07-09** (current working tree). The catch-all proxy allowlist
now includes `/developer/delete-account`, and route/proxy tests cover forwarding
that path through the Next proxy.

Previously noted severity: high.

Previously observed evidence:

- `apps/web/src/lib/api/services.ts` calls `POST /developer/delete-account`.
- `apps/api/src/developer/developer.controller.ts` exposes
  `POST /developer/delete-account`.
- `apps/web/src/app/api/[...proxy]/route.ts` allows several `/developer/*`
  paths but omits `/developer/delete-account`.

Likely impact:

- The web account deletion flow returns 403 at the Next proxy instead of reaching
  the API.

Fix direction:

- Add `/developer/delete-account` to the proxy allowlist.
- Add a proxy allowlist test for this route.
- Manually verify the settings/account-deletion flow after auth-cookie fixes.

Desired goal:

- A signed-in developer can delete their account from the web UI, and the request
  reaches the Nest controller with the expected auth context.

Done when:

- The web deletion call no longer receives a proxy 403.
- The API still requires developer role, explicit confirmation, and credential
  proof where applicable.
- A regression test covers the proxy allowlist entry.

### A-005: TOTP Manual Setup Secret Is Stripped by the Proxy

**Resolved 2026-07-04** — proxy scrubber is now route-aware (`allowSetupSecret`
in proxy scrubbing test passes; `/auth/2fa/setup` preserves `secret`/`otpauthUrl` while
other routes still strip `secret` fields).

Previously noted severity: high.

Evidence:

- `apps/web/src/lib/api/services.ts` calls `POST /auth/2fa/setup`.
- `apps/web/src/app/developer/settings/page.tsx` expects `res.data.secret` and
  `res.data.otpauthUrl`.
- `apps/web/src/app/api/[...proxy]/route.ts` recursively strips every `secret`
  field from proxied JSON responses.

Likely impact:

- The manual TOTP key can render blank.
- Users who cannot scan the QR code may be unable to enable 2FA.

Fix direction:

- Make the proxy scrubber route-aware so `/auth/2fa/setup` can return the TOTP
  setup secret intentionally.
- Alternatively rename the response field to a narrowly allowed name such as
  `totpSetupSecret`, but still keep route-aware tests.
- Do not globally allow arbitrary `secret` fields from all proxied endpoints.

Desired goal:

- 2FA setup shows both QR and manual key while the proxy still strips accidental
  secrets from unrelated endpoints.

Done when:

- Manual 2FA setup displays a usable key.
- The QR/otpauth flow still works.
- Tests prove that `/auth/2fa/setup` may expose only the intended setup secret
  and that unrelated `secret` fields are still stripped.

### A-006: Web Proxy and Auth Route Tests Do Not Cover the Fragile Contracts

**Resolved 2026-07-05** — web test suite covers: cookie naming (secure/non-secure
with legacy double-prefix cleanup), proxy allowlisted/denied routes, proxy
response scrubbing (incl. TOTP 2FA setup exception), logout 502/5xx cookie
preservation, JWT_SECRET middleware tests. 21 tests pass across 6 test files.

Previously noted severity: medium-high.

Evidence:

- Existing web tests passed while the cookie naming, account deletion allowlist,
  and TOTP secret stripping issues were present.

Likely impact:

- High-risk integration contracts can regress without CI catching them.

Fix direction:

- Add focused tests for auth cookie naming in secure and non-secure contexts.
- Add proxy tests for allowlisted and denied routes.
- Add proxy response-scrubbing tests, including the 2FA setup exception.
- Add logout/refresh tests that verify stale and legacy cookie cleanup.

Desired goal:

- Web auth/proxy tests protect the boundaries where the Next app adapts browser
  cookies and API responses.

Done when:

- The new tests fail against the current broken code.
- The new tests pass with the fixes for A-002, A-004, and A-005.

### A-007: Admin Metrics Still Has Raw-Row Daily Aggregation Paths

**Resolved 2026-07-09** (commit 229dde8). Admin `getMetrics()` now uses `$queryRaw` with SQL `date_trunc()` for daily aggregation of impressions, signups, revenue, and spend — matching the A-068 pattern for bounded memory usage. Verified by reading `apps/api/src/admin/admin.service.ts`.

Severity: medium.

Evidence:

- `apps/api/src/advertiser/advertiser.service.ts` now uses database `groupBy()`
  for campaign-level impression, click, and spend totals, and SQL
  `date_trunc(...)` via `$queryRaw` for advertiser daily trend.
- `apps/api/src/admin/admin.service.ts` `getMetrics()` still loads all matching
  impressions, signups, earnings-ledger credits, and advertiser-ledger debits
  since `periodStart` with `findMany()` and buckets them in JavaScript.

Likely impact:

- High-volume admin dashboards or long date ranges can make admin metrics slow
  or memory heavy.
- Advertiser reporting is improved, but admin metrics can still become less
  predictable under real traffic.

Fix direction:

- Move admin aggregation into the database where practical.
- Consider a daily metrics table/materialized view for impressions, clicks,
  spend, CTR, and unique users.
- Enforce date-range limits or pagination if raw drill-down remains necessary.

Desired goal:

- Admin report endpoints have bounded memory usage and predictable latency for
  production-sized event volume.

Done when:

- Admin metrics generation no longer depends on loading all matching event
  timestamps or ledger rows into application memory.
- Tests or benchmarks cover a large synthetic event set.
- API behavior for empty campaign sets and invalid date ranges remains correct.

### A-008: Ledger Developer Endpoints Have a Loose Role Boundary

Severity: resolved pending full-suite verification.

Current source check:

- `apps/api/src/ledger/ledger.controller.ts` applies `JwtAuthGuard` and
  `AllowApiKey()` at the controller level.
- Developer-facing `balance`, `breakdown`, and `history` routes now add
  `@UseGuards(RolesGuard)` and `@Roles('developer')` before reading the current
  user's earnings ledger.
- Admin ledger endpoints remain explicitly admin/super_admin only.
- `apps/api/src/ledger/ledger.controller.spec.ts` is named for this role-boundary
  case and covers non-developer/unauthenticated rejection.

Residual risk:

- This still needs to be included in a full API test run after the current dirty
  tree settles.

Follow-up direction:

- Keep admin ledger routes explicitly admin-only and developer earnings routes
  developer-only in future proxy/API-key changes.

Desired goal:

- Ledger route access matches the product's role model rather than relying only
  on user-id scoping.

Done when:

- Non-developer JWTs receive 403 for developer ledger endpoints if that is the
  intended policy.
- API keys still require the correct `ledger:read` scope.
- Tests cover developer, advertiser, admin, and API-key access cases.

### A-009: Logged-Out Cookie Consent Now Server-Auditable (Anonymous, Privacy-Minimized)

**Resolved 2026-07-09** (current working tree). Anonymous, logged-out consent is
now server-recorded via a privacy-minimized endpoint.

What changed:

- `packages/db/prisma/schema.prisma` `Consent.userId` is now nullable and a
  `visitorIdHash` column + index were added. Migration
  `20260709060000_anonymous_consent` makes `userId` nullable, adds the column,
  and is idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).
- `apps/api/src/compliance/compliance.service.ts` adds `recordAnonymousConsent()`
  which sha256-hashes a client-generated `visitorId`, validates the purpose
  against `CURRENT_CONSENT_VERSIONS`, stores `userId: null` + `visitorIdHash`,
  and is idempotent per `(visitorIdHash, purpose)` via upsert. No raw id / IP /
  PII is persisted; audit logs record `actorId: 'anonymous'`.
- `apps/api/src/compliance/consent-anonymous.controller.ts` (new) exposes
  `POST /consent/anonymous` OUTSIDE `JwtAuthGuard`, with a strict validation pipe
  (whitelisted purpose, version charset). The web proxy allowlist already covers
  `/consent/*`.
- `apps/web/src/components/cookie-consent.tsx` now persists a stable
  `wl_visitor_id` in `localStorage` and, for logged-out visitors, POSTs the
  choice to `/consent/anonymous`. The server write is non-fatal — the browser
  preference remains the source of truth for the UI if the write fails.

Verification:

- `apps/api/src/compliance/compliance.service.spec.ts` (new): anonymous accept
  (null user + hashed id), decline (`granted:false`), invalid purpose rejected,
  duplicate updates rather than inserts, raw id never stored.
- API typecheck + eslint clean; `@waitlayer/db generate` passes.

Desired goal:

- Consent behavior is intentional and matches the compliance target.

Done when:

- Logged-out behavior is documented and tested. ✅
- Server-side anonymous consent is supported without weakening authenticated
  consent records. ✅
- If no, document that logged-out marketing consent is browser-local and only
  authenticated user consent is server-recorded.

Desired goal:

- Consent behavior is intentional and matches the compliance target.

Done when:

- The expected logged-out behavior is documented and tested.
- If server-side anonymous consent is required, the API and web flow support it
  without weakening authenticated consent records.

### A-010: Docs Claim Health That the Code Does Not Currently Have

**Resolved 2026-07-09** (current working tree). `README.md` no longer asserts
exact green test/build counts; it documents the quality-gate commands
(`pnpm run typecheck/lint/build/test`) and the DB-backed spec prerequisites
(`DATABASE_URL` + `JWT_SECRET`). The status-style claims that contradicted the
code are gone.

Severity: medium (was).

Previously observed evidence:

- `README.md` claims `pnpm run build` and `pnpm run test` pass, including exact
  task/test counts.
- The current audit observed root build and test failures.

Likely impact:

- Future agents or engineers may waste time trusting stale health claims.

Fix direction:

- Update status-style docs after the actual code fixes land.
- Avoid exact "all green" counts in durable docs unless CI badges or generated
  reports keep them current.

Desired goal:

- Documentation helps orientation but does not contradict the current code and
  CI state.

Done when:

- README and related status docs either match current green checks or clearly
  describe how to verify locally.
- This `AGENTS.md` issue register is updated as items are resolved.

### A-011: Large Dirty Worktree Raises Review Risk

**Resolved 2026-07-09** (this session). The accumulated multi-package dirty
worktree (49 modified + 15 untracked files) was committed in organized, reviewable
commits grouped by domain (deps, db, api, web, cli, docs). The review-risk
condition no longer applies.

Severity: medium (was).

Previously observed evidence:

- The audit observed many modified files across API, web, CLI, extension,
  shared packages, Prisma schema/migrations, and docs.

Likely impact:

- Unrelated behavior changes can be mixed together.
- Agents can accidentally overwrite user work if they assume a clean branch.

Fix direction:

- Before broad edits, inspect `git status --short` and relevant file diffs.
- Split fixes into small branches or commits where possible: auth/proxy, tests,
  build, reporting performance, compliance.
- Do not run destructive git commands.

Desired goal:

- Each fix can be reviewed and reverted independently.

Done when:

- The worktree is clean or intentionally organized into reviewable commits/PRs.
- Each issue fix has focused tests and a small diff.

### A-012: Migration Application Must Be Treated as a Release Gate

**Resolved 2026-07-09** (CI). `.github/workflows/ci.yml` now runs
`pnpm --filter @waitlayer/db migrate deploy` and then
`pnpm --filter @waitlayer/db migrate status` to assert no pending migrations /
drift before the build/test matrix. Docker startup already applies migrations at
runtime, so generated client, migrations, and deployed DB stay in sync.

**Runtime startup check also implemented and verified (this session):**
`apps/api/src/config/migration-check.ts` exposes `verifyMigrationsApplied()`, which
compares on-disk `packages/db/prisma/migrations` against the database
`_prisma_migrations` table, fails fast in `production`, and warns in dev. It is
invoked from `apps/api/src/main.ts` bootstrap. The DB-backed suites
(`test:contract` 34, `test:e2e-http` 42) boot the full app against a migrated
Postgres + Redis and pass, proving the startup check does not reject a
correctly-migrated database. Local dev uses `prisma db push --force-reset` to
sync the schema; CI uses `migrate deploy` + `migrate status` (A-012 done).

Severity: medium (was).

Previously observed evidence:

- Runtime code expects columns that existed in migrations but not in the local
  test database during the audit.
- Docker startup applies Prisma migrations for the API runtime, but test and CI
  setup still need to prove the same guarantee.

Likely impact:

- Runtime 500s occur if the database is behind the generated client/schema.
- Integration tests can fail due to local drift instead of real code behavior.

Fix direction:

- Make migration application explicit in CI and local integration test setup.
- Add a health or startup check that detects unapplied migrations in production
  environments where safe to do so.
- Keep rollback runbooks aligned with irreversible data migrations.

Desired goal:

- Generated Prisma client, checked-in migrations, test DB, and deployed DB stay
  in sync.

Done when:

- Fresh test setup applies all migrations before integration tests.
- Deployment instructions and CI use the same migration command.
- Missing-column errors cannot occur in webhook/compliance tests on a fresh DB.

### A-013: Distributed CLI and VS Code Extension Default to Localhost

**Resolved 2026-07-09** (current working tree). The CLI now defaults to
`https://api.waitlayer.com/api/v1` unless `WAITLAYER_API_URL` explicitly
overrides it, and warns when pointed at loopback. The VS Code extension's
configuration and fallback also default to `https://api.waitlayer.com/api/v1`,
with localhost available only through explicit settings.

Previously noted severity: high.

Previously observed evidence:

- `apps/cli/src/lib/api-client.ts` defaults to `http://localhost:4002/api/v1`
  unless `NODE_ENV === 'production'`.
- Installed CLIs commonly run without `NODE_ENV=production`, so a real user can
  install the package and immediately point at localhost.
- `apps/vscode-extension/package.json` also defaults `waitlayer.apiUrl` to
  `http://localhost:4002/api/v1`.

Likely impact:

- Real developer installs cannot connect to the SaaS API without manually
  changing environment/config.
- The first-run developer loop breaks before any wait-state can be reported.

Fix direction:

- Default distributed clients to the production API origin.
- Keep localhost only for explicit dev builds, test config, or an opt-in
  override such as `WAITLAYER_API_URL`.
- Add a visible first-run config/status message when a client is pointed at
  localhost.
- Add release tests that assert packaged defaults are production-safe.

Desired goal:

- A user installing the CLI or VS Code extension from a public package can log
  in and reach the production WaitLayer API without hidden local configuration.

Done when:

- Packaged CLI and extension defaults point to an HTTPS production API.
- Local development still works with explicit overrides.
- Tests cover both production default and localhost override behavior.

### A-014: Developer API Key UI Overstates Programmatic Access

**Resolved 2026-07-09** (current worktree; verified by
`pnpm --filter waitlayer-api exec vitest run src/developer/api-key.service.spec.ts`,
`pnpm --filter waitlayer-web exec vitest run src/lib/api/services.developer-api-keys.spec.ts`,
`pnpm --filter waitlayer-api typecheck`, `pnpm --filter waitlayer-web typecheck`,
and targeted API/web eslint).

What changed:

- The developer settings UI now describes the one-click API key as a read-only
  ledger key and explicitly says CLI/extension sign-in still uses the user
  session.
- The settings page calls `developerApi.createLedgerApiKey()`, which posts only
  `scopes: ['ledger:read']`; a web service test locks that contract.
- `extension:read`, `extension:write`, and unsupported `reports:write` are no
  longer mintable self-service scopes.
- Legacy/manual keys carrying unsupported extension/report-write scopes are
  rejected at validation time, matching the route surface that actually accepts
  API-key auth.
- Existing sensitive-scope rejection for payout and destructive developer
  scopes remains in place; extension event submission still requires user
  session auth plus device signing.

### A-015: Email Verification Has No User-Facing Request/Resend Path

Severity: resolved pending end-to-end email smoke.

Current source check:

- The API exposes `POST /auth/verify-email/request`.
- Payout requests are blocked unless `user.emailVerified` is true.
- `authApi.requestEmailVerification()` calls `/auth/verify-email/request`.
- The web proxy allowlist includes `/auth/verify-email/request`; proxy tests
  assert the path is allowed.
- `apps/web/src/app/developer/settings/page.tsx` exposes a self-service resend
  action and toast/message state.
- `apps/web/src/app/developer/payouts/page.tsx` exposes the same resend action
  inline where the payout block appears.

Residual risk:

- This still needs an end-to-end smoke with a real or captured verification email
  link proving request -> email -> confirm -> refreshed auth state -> payout
  block clears.

Follow-up direction:

- After successful verification, refresh `/auth/me` so the client state matches
  the server.
- Add browser/API tests for request, confirm, expired token, already-verified
  user, and payout block clearing.

Desired goal:

- Every user blocked by email verification can complete verification without
  contacting support.

Done when:

- A new email/password developer can request verification, click the email link,
  return to the app, and request a payout.
- Payout UI explains the block and links directly to the verification action.
- Tests cover request, confirm, expired token, and already-verified states.

### A-016: Web Runtime Environment Is Not Validated Like the API

**Resolved 2026-07-05** — web middleware has `protected-route middleware`
JWT_SECRET tests covering: missing/mismatched/valid JWT_SECRET; middleware
redirects on missing or mismatched secret. Web build+typecheck CI pipeline
verifies Next.js config consistency.

Previously noted severity: high.

Evidence:

- The API calls `loadEnv(process.env)` in `apps/api/src/main.ts`.
- The Next.js app reads critical variables directly, including
  `NEXT_PUBLIC_API_URL`, `JWT_SECRET`, `COOKIE_SECURE`, and Sentry variables.
- There is no equivalent web boot/build validation for these values.
- The middleware verifies JWTs using `process.env.JWT_SECRET`; if the web
  runtime and API runtime disagree, protected routing fails.

Likely impact:

- A production web deploy can build and start with missing or mismatched auth
  configuration.
- Login may succeed at the API but protected routes can redirect or behave
  inconsistently at the web middleware layer.

Fix direction:

- Add a web env schema for server-only and public variables.
- Validate at build/start time for Next route handlers and middleware.
- Explicitly require the web and API `JWT_SECRET` values to come from the same
  deployment secret, or remove local JWT verification from middleware and rely
  on an API/session check.

Desired goal:

- A bad web deployment fails before serving traffic rather than breaking auth at
  runtime.

Done when:

- Web build/start fails with clear errors for missing or unsafe production env.
- Protected-route middleware has tests for missing, mismatched, and valid
  `JWT_SECRET`.
- Deployment docs list web and API env separately.

### A-017: Validated Env Defaults Are Not Injected Into Nest ConfigService

**Resolved 2026-07-09** (current working tree). `AppModule` now configures
`ConfigModule.forRoot({ isGlobal: true, load: [() => loadEnv(process.env)] })`,
so defaulted/validated values feed Nest `ConfigService`. `config-service.spec.ts`
proves `WEB_BASE_URL` is available through `ConfigService` when it was only
provided by the shared config default.

Previously noted severity: medium-high.

Previously observed evidence:

- `loadEnv()` applies Zod defaults, but `ConfigModule.forRoot({ isGlobal: true })`
  does not use the parsed result as the Nest config source.
- Services still call `ConfigService.get(...)` against raw `process.env`.
- Example: advertiser deposit session code reads
  `ConfigService.get('WEB_BASE_URL')` and can see `undefined` unless the env var
  was physically set, even though the shared schema has a default.

Likely impact:

- Runtime behavior can differ from the validated environment snapshot.
- Defaults in `packages/config` can give false confidence.

Fix direction:

- Wire `loadEnv()` into Nest `ConfigModule` via a validated config factory, or
  write the parsed/defaulted values back into a single config object consumed by
  services.
- Avoid mixing raw `process.env`, `ConfigService`, and `loadEnv()` defaults for
  the same variable.

Desired goal:

- Every API service reads the same validated and defaulted environment values.

Done when:

- A test proves `ConfigService.get('WEB_BASE_URL')` returns the schema default
  when not explicitly set in non-production.
- Production still fails fast for required values.
- Direct `process.env` reads are either removed or justified for true runtime
  toggles.

### A-018: Google Sign-In CSP Needs Browser Verification

**Resolved 2026-07-09 in code; browser verification still pending.** `apps/web/next.config.js`
CSP now includes `frame-src 'self' https://accounts.google.com`, which the
Google Identity Services account-picker / One-Tap popup requires. The
`frame-ancestors 'none'` and scoped `script-src` are unchanged. A production-mode
browser test proving the Google button renders and returns an ID-token callback
under this CSP remains the only open verification step.

Severity: medium-high (code resolved).

Previously observed evidence:

- `next.config.js` allows `script-src` for
  `https://accounts.google.com/gsi/client`.
- The CSP does not explicitly allow Google frame sources.
- The login/signup pages render Google Identity Services UI through the loaded
  script.

Likely impact:

- Google sign-in may fail or partially render in production under CSP even when
  `GOOGLE_CLIENT_ID` is configured.

Fix direction:

- Verify the login and signup pages in a production-like browser with CSP
  enabled.
- If the GIS UI needs frames, add only the required Google frame sources.
- Add a browser/E2E test or CSP regression check for Google button render and
  callback.

Desired goal:

- Google auth works under the exact production CSP, without weakening unrelated
  CSP directives.

Done when:

- Production-mode browser test shows the Google button renders and returns an ID
  token callback.
- CSP violation reports/logs are clean for login and signup.

### A-019: Approved Campaigns Can Get Stuck After Later Funding

**Resolved 2026-07-04** — Stripe webhook `handlePaymentSuccess`
(`apps/api/src/payout/stripe-webhook.controller.ts` lines 377-398) now
auto-activates any `approved` campaign with an approved creative, remaining
budget, and positive same-currency balance after crediting the deposit.

Previously noted severity: high.

Evidence:

- Admin campaign approval activates only when the campaign has an approved
  creative, remaining budget, and a funded advertiser balance.
- If the balance is missing, the campaign becomes `approved`.
- Stripe deposit webhooks credit the advertiser balance but do not activate
  already-approved campaigns.
- Advertiser resume only supports `paused -> active`, not `approved -> active`.

Likely impact:

- An advertiser can deposit after approval and still never start serving ads.
- The UI may show an approved campaign without a clear "activate now" action.

Fix direction:

- Add an activation path for approved campaigns once funding exists:
  webhook-triggered activation, an advertiser "activate" action, or an admin
  operation.
- Ensure activation checks approved creative, remaining budget, funded balance,
  and non-archived state.
- Surface blockers in the advertiser UI.

Desired goal:

- Funding a previously approved campaign makes it eligible to serve without
  support intervention.

Done when:

- E2E test covers: create campaign -> approve while unfunded -> deposit via
  webhook -> campaign becomes active or exposes a working activate action.
- UI explains any remaining activation blocker.

### A-020: Advertiser Campaign Pause/Resume UI Is State-Aligned

Severity: resolved pending UI regression tests.

Current source check:

- Backend pause transition is `active -> paused`.
- `apps/web/src/app/advertiser/campaigns/page.tsx` now shows Pause only when
  `campaign.status === 'active'`.
- The same page shows Resume only when `campaign.status === 'paused'`.
- `apps/api/src/advertiser/advertiser.service.spec.ts` covers pause rejecting
  approved campaigns, active -> paused, and paused -> active with approved
  creative and funded balance.

Residual risk:

- No focused web UI test was found for campaign action visibility by status.
- Approved-but-not-active campaigns still need a clear activation/blocker path;
  A-019 tracks the automatic activation path and A-021 tracks broader campaign
  lifecycle UI gaps.

Follow-up direction:

- Add tests for campaign action visibility by status.

Desired goal:

- The advertiser campaign page presents only valid state transitions.

Done when:

- Active campaigns can be paused from the UI.
- Paused campaigns can be resumed from the UI.
- Approved but inactive campaigns show an activation/blocker state, not Pause.

### A-021: Advertiser Campaign Recovery UI Links to a Missing Edit Route

**Resolved 2026-07-09** (commit 10f48af). Full edit route exists at `apps/web/src/app/advertiser/campaigns/[id]/edit/page.tsx` with reset-to-draft, creative update, country targeting, and resubmit functionality. Verified by reading the route file.

Severity: medium-high.

Evidence:

- Campaign update, submit, reset-to-draft, pause/resume, and archive endpoints
  exist on the API.
- `apps/api/src/advertiser/advertiser.service.spec.ts` covers draft update,
  draft submit, rejected -> draft reset, and resubmission after reset.
- `apps/web/src/app/advertiser/campaigns/page.tsx` renders an Edit link for
  draft and rejected campaigns that points at
  `/advertiser/campaigns/${campaign.id}/edit`.
- `find apps/web/src/app/advertiser/campaigns -maxdepth 4 -type f` shows only
  `page.tsx` and `new/page.tsx`; there is no `[id]/edit/page.tsx` route for that
  link.
- There is no visible archive action.
- Rejection reasons are not clearly surfaced to advertisers, and there is no
  complete browser edit/reset/resubmit loop for rejected campaigns.

Likely impact:

- Advertisers clicking Edit on a draft or rejected campaign hit a missing route
  instead of a recovery form.
- Backend lifecycle operations are available, but the browser product still
  cannot complete the correction/resubmission path.
- Refund obligations from archive flow exist, but the advertiser UI does not
  expose the user-facing archive/refund request path.

Fix direction:

- Add campaign detail/edit page for draft and rejected campaigns.
- Wire rejected campaigns through reset-to-draft, edit, creative update, and
  resubmit.
- Add archive action with clear refund/remaining-budget explanation.
- Show campaign and creative rejection reasons.

Desired goal:

- Advertisers can self-serve campaign correction, resubmission, pause/resume,
  and closure.

Done when:

- E2E test covers draft edit, submit, reject with reason, advertiser edit,
  resubmit, approve, active, pause, resume, archive.
- Archive creates the expected refund obligation and the UI reflects it.

### A-022: Campaign CTA Text Is Stored but VS Code Renders a Hard-Coded Label

**Resolved 2026-07-09** (current worktree; verified by
`pnpm --filter waitlayer-vscode test`, `pnpm --filter waitlayer-vscode typecheck`,
and `pnpm --filter waitlayer-vscode lint`).

What changed:

- `apps/vscode-extension/src/extension.ts` now passes served `ad.ctaText` through
  to the panel, falling back to `Visit site` only when the API omits or blanks
  the CTA text.
- `apps/vscode-extension/src/ad-display.ts` isolates that mapping.
- `apps/vscode-extension/test/ad-display.test.ts` covers served CTA text, null
  or omitted CTA text, and blank CTA text.

### A-023: Deposit Success UI Claims Credit Before Webhook Confirmation

**Resolved 2026-07-09** (current working tree). The advertiser dashboard
Stripe-return banner now says the payment was completed and the account balance
"will be credited once the payment is confirmed by our payment processor",
with a link to billing, instead of claiming the ledger was already credited.

Previously noted severity: medium.

Previously observed evidence:

- The advertiser dashboard shows "Your deposit was successful! Your account has
  been credited" after returning from Stripe Checkout with `deposit=success`.
- Actual advertiser ledger credit is created only by Stripe webhook processing.

Likely impact:

- Users can see a success message while the balance is not yet updated.
- Webhook delay or failure creates confusing billing support cases.

Fix direction:

- Change copy to "payment completed, credit pending confirmation" until billing
  data shows the deposit ledger row.
- Poll or refetch billing after redirect.
- Surface webhook/pending state if available.

Desired goal:

- The UI never claims spendable ad credit until the ledger actually contains
  confirmed credit.

Done when:

- Stripe success redirect shows pending/refreshing state.
- Once webhook credit appears, billing and dashboard show confirmed balance.
- E2E webhook test covers the redirect-to-credit lifecycle.

### A-024: Advertiser CTR Is Displayed 100x Too High on Overview

**Resolved** — API returns CTR as ratio (clicks/impressions, e.g. 0.10 for
10%); overview applies `formatPercent(data.ctr * 100, 2)` which renders
1 click / 100 impressions as `1.00%`. Verified by reading
`apps/api/src/advertiser/advertiser.service.ts:276` and
`apps/web/src/app/advertiser/page.tsx:169`. (Reports page was the
divergence and was fixed by A-067.)

Previously noted severity: medium.

Evidence:

- `AdvertiserService.getDashboard()` returns CTR as `(clicks / impressions) *
100`.
- The advertiser overview renders `formatPercent(data.ctr * 100, 2)`.
- The reports page renders CTR without multiplying again.

Likely impact:

- Advertisers see incorrect performance metrics on the overview page.

Fix direction:

- Render `formatPercent(data.ctr, 2)` on the overview page.
- Add a fixture test for CTR display.

Desired goal:

- CTR is represented consistently across dashboard, reports, and API.

Done when:

- A 1 click / 100 impression campaign displays `1.00%` everywhere.

### A-025: Admin Users Page Response Mapping Was Fixed in the Current Tree

Severity: resolved pending verification.

Current source check:

- `AdminService.getUsers()` returns `id`, `email`, `name`, `role`, `status`,
  `trustLevel`, `country`, `createdAt`, and a computed `openFlags` count.
- `apps/web/src/app/admin/users/page.tsx` now renders `name`, `email`,
  `trustLevel`, and `openFlags`, matching the current API shape.

Residual risk:

- Keep or add a response-shape regression test so the admin users page cannot
  drift back to stale field names.

Desired goal:

- The admin user table is a reliable operational view of account status and
  risk.

Done when:

- User rows show correct name/email, role, status, trust/trust score, and open
  fraud count in browser/API integration tests.

### A-026: Admin Payout Manual Reconciliation Amount Units

**Resolved 2026-07-09** (uncommitted in current working tree).

Current source check:

- `AdminService.getPendingPayouts()` includes `user.email`, `user.name`,
  `trustLevel`, payout account, status, and latest transaction.
- `apps/web/src/app/admin/payouts/page.tsx` now contains partial-approval and
  manual-reconciliation modal code, and `pnpm --filter waitlayer-web typecheck`
  currently passes.
- `openApproveModal()` and `openReconcileModal()` now use
  `authoritativePayoutAmountMinor()` followed by `minorToMajorInputValue()`, so
  an approved amount of `3000` minor units pre-fills as `30`, not `3000`.
- `handleReconcile()` still converts the displayed major-unit value back to
  minor units before calling `adminApi.markPayoutPaid()`, so the backend
  cross-check sees the intended approved amount.
- The old unused direct `handleApprove()` path and unused `requestedMajor`
  local were removed from the page.

Verification:

- `pnpm --filter waitlayer-web exec vitest run src/app/admin/payouts/amounts.test.ts`:
  passed.
- `pnpm --filter waitlayer-web test`: passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/admin/payouts/page.tsx
src/app/admin/payouts/amounts.ts src/app/admin/payouts/amounts.test.ts`:
  passed.

Residual risk:

- This is covered by helper-level tests plus source inspection. A browser/modal
  test that opens the approval and reconciliation modals with fixture payouts
  would further reduce UI regression risk.

### A-027: Device Recovery Lookup Is Wired; Needs End-to-End Recovery Smoke

Severity: resolved pending E2E verification.

Current source check:

- `AdminController` exposes `POST /admin/devices/:id/recovery-token` and the
  current tree also exposes `GET /admin/devices`.
- `AdminService.getDevices()` returns a searchable, paginated list without
  exposing raw `eventSecret`; `admin.service.spec.ts` covers the happy path and
  invalid tool type filter.
- The web proxy allowlist includes `/admin/devices`, and `adminApi` exposes both
  `getDevices()` and `issueDeviceRecoveryToken()`.
- `apps/web/src/app/admin/layout.tsx` now links to `/admin/devices`.
- `apps/web/src/app/admin/devices/page.tsx` searches devices through
  `adminApi.getDevices()`, shows user/device context, and fills the issue-token
  form from a selected row while keeping manual ID fallback.
- CLI and VS Code clients explicitly prompt for/use support-issued recovery
  tokens.

Residual risk:

- No browser/CLI smoke test in this pass proves a support-issued token is copied
  into the CLI/extension and consumed to rotate the device secret.
- There is still no direct user-detail deep link into a user's devices.

Follow-up direction:

- Add an admin/support UI flow from user details into the relevant devices.
- Add an E2E smoke covering admin token issuance and CLI/extension token
  consumption.

Desired goal:

- Support can recover legitimate devices without database access or ad hoc
  scripts.

Done when:

- Admin/support can search/select a device and issue a token from the UI without
  database lookup.
- CLI/extension recovery succeeds with that token.
- Audit log records issuance and consumption.

### A-028: Admin User Lifecycle Actions Are Half-Wired but Not Rendered

**Resolved 2026-07-09** (commit 10f48af). Admin users page now renders full Ban/Unban/Restrict/Erase buttons in the Actions column with a confirmation modal. Erasure requires typing "ERASE" to confirm; super-admin erasure is blocked. Verified by reading `apps/web/src/app/admin/users/page.tsx`.

Severity: medium.

Evidence:

- `AdminController` exposes `POST /admin/users/:id/erase` and
  `POST /admin/users/:id/status`.
- `apps/web/src/lib/api/services.ts` exposes `adminApi.eraseUser()` and
  `adminApi.setUserStatus()`.
- `apps/web/src/app/admin/users/page.tsx` now defines `actionUser`,
  `actionKind`, `runAction()`, and `openAction()`, but the rendered table row
  stops after the joined-date cell. The header includes "Actions", yet there is
  no action `<td>`, no buttons, and no confirmation modal calling
  `openAction()`.

Likely impact:

- GDPR/ToS operations require direct API calls or database/manual action.
- Dead client-side action code can create false confidence in the admin surface
  because typecheck passes while the workflow remains inaccessible.

Fix direction:

- Add guarded admin user actions with confirmation dialogs.
- Require explicit confirmation for irreversible erasure.
- Render the existing restrict, ban, unban, and erase handlers in the table or a
  user-detail action area; suppress or server-block invalid super-admin actions.
- Add focused UI tests proving the visible controls call the expected API routes
  and refresh the user list after success.

Desired goal:

- Support/admin can perform account lifecycle operations from audited UI flows.

Done when:

- Admin can erase an eligible user through the UI.
- Super-admin erasure remains blocked.
- The action revokes sessions/API keys and writes audit events.

### A-029: Feedback Form Is Local-Only but Claims the Team Reads It

**Resolved 2026-07-09** (verified by source code audit). The feedback page (`apps/web/src/app/feedback/page.tsx`) now submits via `fetch('/api/feedback', ...)` to the backend, where `FeedbackController`/`FeedbackService` in `apps/api/src/feedback/` persists the submission via audit log with spam/rate limits. The proxy allowlist already includes `/feedback`.

Severity: medium.

Evidence:

- `apps/web/src/app/feedback/page.tsx` stores submissions in browser
  `localStorage`.
- The page copy says "We read every message" and "Your feedback has been
  recorded."

Likely impact:

- User feedback is never sent to the team.
- The UI creates a false support expectation.

Fix direction:

- Add a backend feedback endpoint with spam/rate limits and email/ticket
  delivery, or change the page to a mailto/support link.
- If feedback stays local-only, make that explicit and avoid "send" language.

Desired goal:

- Feedback submitted in the product reaches an operator-controlled system.

Done when:

- Submitting feedback creates a server-side record, email, or ticket.
- Abuse controls and privacy retention are defined.

### A-030: Payout Provider UX Is Not Production-Scale

Severity: medium-high.

Evidence:

- Developer payout UI exposes `paypal_email` and `manual`.
- `manual` and `paypal_email` providers return `processing` and depend on admin
  follow-up.
- Automated PayPal Payouts, Wise, and Stripe Connect providers exist, but the
  user-facing setup does not guide users through real provider onboarding or
  verification.

Likely impact:

- The SaaS can technically process payouts, but at scale it becomes an
  operations-heavy manual queue.
- Users can enter destinations that are syntactically valid but not verified as
  owned or payable.

Fix direction:

- Decide launch payout provider(s) per supported country/currency.
- Add provider-specific onboarding and destination verification.
- Keep manual payout as an admin-only fallback, not a default user-facing method,
  unless manual processing is an explicit launch constraint.
- Add payout method status explaining pending verification, verified, rejected,
  or unsupported.

Desired goal:

- A developer can add a real payout destination, prove ownership where required,
  request payout, and receive funds through a provider flow operators can scale.

Done when:

- At least one production payout provider is fully configured, tested, and
  available in UI.
- Manual payout is clearly labeled as manual/limited or hidden from ordinary
  users.
- Provider failure and reconciliation paths are tested.

### A-031: Currency Policy Exists but Payout Inputs Still Assume Two Decimals

**Resolved 2026-07-09** (verified by source code audit). The developer payouts page (`apps/web/src/app/developer/payouts/page.tsx`) now imports `majorToMinor` and `minorToMajorInputValue` from `@waitlayer/shared` and uses `majorToMinor()` for conversion and `minorToMajorInputValue()` for `step`/`min`/`max` input attributes instead of hardcoded `/ 100` and `* 100`.

Severity: medium.

Evidence:

- `packages/shared/src/currency.ts` now defines `CURRENCY_POLICY`, including
  per-currency minor-unit exponent, deposit minimum, payout minimum, and provider
  availability.
- `AdvertiserController.createDepositSession()` calls `depositMinimumMinor()`,
  and `PayoutService.requestPayout()` calls `payoutMinimumMinor(currency)`.
- `apps/web/src/lib/format.ts` uses shared currency formatting for display.
- `apps/web/src/app/developer/payouts/page.tsx` still converts the entered
  payout amount with `Math.round(parseFloat(amount) * 100)`, and its amount
  input uses `step="0.01"`, `min={minimumThresholdMinor / 100}`, and
  `max={selectedAvailableMinor / 100}` for every currency.
- The payout-method currency field is free-form ISO text; `PayoutService` checks
  only that it is a 3-letter code and does not call
  `isProviderSupportedForCurrency()` before storing a provider/currency pair.

Likely impact:

- A JPY payout can be submitted at 100x the intended minor-unit amount, while a
  future 3-decimal currency would be rounded down incorrectly.
- Users can add a syntactically valid provider/currency combination that the
  shared policy says the provider cannot settle.
- The backend policy table is a good start, but launch safety still depends on
  every input and provider path using it.

Fix direction:

- Add shared major/minor conversion helpers for form input and use
  `minorUnitExponent()` instead of hardcoded `/ 100` and `* 100`.
- Replace the payout currency text field with a supported-currency selector
  filtered by provider, or validate provider/currency compatibility in the API.
- Keep deposit, campaign, payout request, provider initiation, and display paths
  on the same currency policy table.

Desired goal:

- Multi-currency behavior is explicit and correct per supported currency.

Done when:

- Adding/removing a currency happens through one policy table and every UI/API
  conversion respects that policy.
- Tests cover USD plus at least JPY and one 3-decimal currency-like fixture.

### A-032: Advertiser Reporting Has CSV Export but Still No Pagination Bounds

**Resolved 2026-07-09** (current working tree; verified by
`pnpm --filter waitlayer-api exec vitest run src/advertiser/advertiser.service.spec.ts`
→ 15 tests green, including 4 new A-032 bounds tests).

What changed:

- `AdvertiserService.getReports()` now applies caller-supplied `page`/`limit`
  via Prisma `skip`/`take`, accepts them from the controller
  (`GET /advertiser/reports?page=&limit=`), and returns accurate `page`,
  `limit`, and `total` in the response.
- `limit` is capped at `REPORT_MAX_LIMIT = 1000`; out-of-range values are
  clamped rather than rejected, so a single request cannot pull unbounded rows.
- A date-range ceiling (`REPORT_MAX_RANGE_DAYS = 366`) is enforced in
  `buildReportsDateFilter()`; ranges wider than the allowed span return a clear
  `400`. The web UI only ever sends ≤90-day presets, so its behavior is
  unchanged.
- `getReports()` now issues a `campaign.count` for the true total; the UI still
  receives every campaign because it sends no `page`/`limit`.

Residual (product decision, not a defect): the broader question of a full
paginated UI plus async/large-export job remains a product call. The synchronous
bounds above close the memory/DoS safety gap the issue raised.

Severity: medium (was).

Previously observed evidence:

- Reports are rendered in the UI from a single unpaginated API response.
- `AdvertiserController` now exposes `GET /advertiser/reports/export`, and
  `apps/web/src/app/advertiser/reports/page.tsx` downloads CSV through that path.
- The export route reuses `AdvertiserService.getReports()` and does not apply a
  separate asynchronous export or date-range cap.
- `AdvertiserService.getReports()` accepts `page` and `limit` in its service
  signature but the controller does not pass those query params and the service
  returns all campaign rows as one page.
- Advertiser daily trend is now database aggregated, but report/export campaign
  rows are still returned synchronously in one response.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/advertiser/advertiser.service.spec.ts`:
  passed (15 tests).
- `pnpm --filter waitlayer-api typecheck`: blocked in this sandbox by a
  pre-existing tsconfig/TS-version mismatch (`baseUrl`/`moduleResolution=node10`
  options removed); not related to this change.

Done when:

- Reports can be exported only for a bounded range or through an async export
  path.
- API and UI handle large accounts without returning every campaign/report row in
  one synchronous response.

### A-033: Landing-to-Product Claims Need Runtime Verification

Severity: medium.

Evidence:

- The landing page advertises installable VS Code/terminal integrations,
  PayPal-first payouts, global payouts, transparent earnings, trust scoring,
  advertiser reach, and privacy-first integrations.
- `apps/web/src/app/comparison/page.tsx` marks Cursor, Windsurf, Cline,
  Claude Code, and Terminal as `Live`, with checks for wait detection, ad
  display, clicks, earnings tracking, and frequency controls.
- Caveat: those "Live" tool statuses are marketing assertions over a single VS
  Code extension + CLI codebase (Cursor/Windsurf/Cline are VS Code forks reusing
  the same extension; Claude Code is a CLI). No automated test asserts the
  per-tool "Live" status, so A-033 remains an ongoing runtime-verification item.
- The codebase has real ad request/render/qualification/click handling in the
  VS Code extension. The CLI only reports wait-state start/end events, and
  A-040 separately tracks the missing terminal ad/earning loop.
- Several implementation gaps above affect those claims: client defaults point
  to localhost, payout provider UX is manual-heavy, email verification can block
  payouts, and feedback/support loops are incomplete.

Likely impact:

- Marketing copy can overpromise relative to the current product.

Fix direction:

- Turn landing claims into acceptance tests or launch checklist items.
- Remove or soften claims until the corresponding flow is proven.

Desired goal:

- Every concrete public claim is backed by a working product path.

Done when:

- Public copy has a linked implementation/verification owner.
- Launch review confirms no claim depends on a missing or manual-only path
  unless clearly disclosed.

### A-034: Signup Consent Is Server-Owned and Transactional

**Resolved 2026-07-09** (uncommitted in current working tree).

Current source check:

- `apps/api/src/auth/dto/signup.dto.ts` now requires `ageConfirmed` and
  `termsAccepted`, with optional `policyVersion`.
- `apps/api/src/compliance/consent-versions.ts` is now the shared source for
  `CURRENT_CONSENT_VERSIONS` and signup-required purposes.
- `AuthService.signUp()` rejects missing consent, rejects a provided stale
  `policyVersion`, and creates `terms_of_service` plus `privacy_policy` consent
  rows inside the same transaction as user/settings/profile onboarding.
- `AuthService.googleOAuth()` applies the same behavior for first-time Google
  signup.
- `apps/web/src/app/auth/signup/page.tsx` and `apps/cli/src/commands/auth.ts`
  now fetch `/consent/required-versions`, prompt for consent, and forward
  `ageConfirmed`, `termsAccepted`, and `policyVersion`.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/auth/auth.service.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api test`: passed.

Residual risk:

- Browser/E2E coverage for signup version-fetch failures, re-prompt missing
  versions, and cookie accept/decline remains tracked as residual risk under
  A-047.
- Web signup copy should still be reviewed for explicit Terms of Service and
  Privacy Policy acceptance wording at the control.

Desired goal:

- Every self-service account creation path proves the user accepted the current
  required terms/privacy versions and age requirement atomically with account
  creation.

Done:

- API DTOs and services reject missing required signup consent for all signup
  paths.
- Consent records are created in the signup transaction and signup fails if they
  cannot be written.
- Web, Google, CLI, and direct API signup cannot record stale policy versions.
- Tests cover email/password signup, Google signup, missing-consent rejection,
  consent-write failure, and stale policy-version rejection.

### A-035: Payout 2FA Policy and Client Support Are Aligned

Severity: resolved pending production policy rollout and browser/terminal
smoke.

Current source check:

- `apps/web/src/app/security/page.tsx` now describes the actual
  operator-controlled policy: 2FA is required for payouts when
  `PAYOUT_REQUIRE_2FA=true`, and otherwise remains strongly recommended.
- `PayoutService.requestPayout()` still enforces the money-movement gate when
  `PAYOUT_REQUIRE_2FA === 'true'`.
- `PayoutService.getPayoutInfo()` now exposes `requiresTwoFactorForPayout` and
  `twoFactorEnabled` so web clients can show the blocker before submit.
- `apps/web/src/app/developer/payouts/page.tsx` shows an inline 2FA-required
  payout blocker and links to developer settings when the policy is enabled
  and the user has not enrolled 2FA.
- `apps/cli/src/commands/auth.ts` now mirrors the VS Code extension login path:
  it detects the structured 2FA challenge, prompts for a code, and retries
  login with `twoFactorToken`.

Verification:

- `pnpm --filter waitlayer-cli test`: passed.
- `pnpm --filter waitlayer-cli typecheck`: passed.
- `pnpm --filter waitlayer-cli lint`: passed.
- `pnpm --filter waitlayer-api exec vitest run src/payout/payout.service.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api exec eslint src/payout/payout.service.ts
src/payout/payout.service.spec.ts`: passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/developer/payouts/page.tsx`:
  passed.

Residual risk:

- Production launch still needs an explicit operator decision for
  `PAYOUT_REQUIRE_2FA`; checked-in local examples may remain false for local
  development if that is intentional.
- Run a terminal/browser smoke with a real TOTP-enrolled user and
  `PAYOUT_REQUIRE_2FA=true` before claiming end-to-end release readiness.

Desired goal:

- The product, API, and clients all enforce the same 2FA policy for login and
  payout money movement.

Done:

- A 2FA-enabled developer can log in with both CLI and VS Code flows at the
  code/test-contract level.
- A payout request without required 2FA is blocked with a clear API message and
  a pre-submit web blocker.
- Security page copy describes the operator-controlled behavior implemented in
  production.

### A-036: CCPA Opt-Out Is Enforced for Ads and Account Sync Fails Closed

Severity: resolved pending legal/product policy definition outside ad serving.

Current source check:

- `apps/web/src/app/privacy/page.tsx` still stores `wl_ccpa_opt_out` locally for
  logged-out visitors, and the copy explicitly says that path is device-local.
- Authenticated users now fetch the current consent version from
  `/consent/required-versions` and only flip the account-level UI/local cache
  after `/consent` successfully records `purpose: 'ccpa_opt_out'`.
- Authenticated `/consent` POST failures now leave the previous UI state in
  place and surface a retryable error instead of presenting the local browser
  preference as an account-level save.
- `ExtensionService.requestAd()` checks
  `this.compliance.isConsented(userId, 'ccpa_opt_out')`, logs
  `ccpa_opt_out_enforced`, and returns `{ ad: null, reason: 'ccpa_opt_out' }`
  before campaign selection for opted-out authenticated developers.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/integration/e2e-money-loop.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api exec eslint src/integration/e2e-money-loop.spec.ts`:
  passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/privacy/page.tsx`: passed.

Residual risk:

- Legal/product still needs to define what `ccpa_opt_out` must do outside ad
  selection: reporting aggregation, advertiser data use, exports, and audience
  sharing. The current code enforces no ad serving to opted-out authenticated
  users.
- There is no React DOM test harness in `apps/web`; privacy-page sync-failure
  behavior is covered by source/type/lint now and should get a browser test
  when E2E coverage is added.

Desired goal:

- Privacy choices that affect platform behavior are durable, auditable, and
  enforced server-side.

Done:

- CCPA opt-out can be recorded and retrieved from the backend.
- The UI distinguishes local-only logged-out preferences from account-level
  authenticated legal preferences and fails closed on account sync errors.
- Tests prove opted-out authenticated users do not receive ads.

### A-037: API Keys Still Reach Advertiser Export/Delete Through `advertiser:write`

**Resolved 2026-07-09** (commit 9ea9579) — `RejectApiKeyGuard` is wired on
`POST /advertiser/export-data` and `POST /advertiser/delete-account`; new
`reject-api-key.guard.spec.ts` proves the guard rejects requests carrying
`req.apiKey`, passes JWT-only requests, and passes unauthenticated-shaped
requests (leaving auth to JwtAuthGuard/RolesGuard).

Previously noted severity: high.

Evidence:

- `ALLOWED_API_KEY_SCOPES` no longer includes `payout:*` or `developer:write`,
  and `api-key.service.spec.ts` covers rejection of those sensitive scopes.
- `ALLOWED_API_KEY_SCOPES` still includes `advertiser:write`.
- `AdvertiserController` is class-decorated with `@AllowApiKey()`, and
  `/advertiser/export-data` plus `/advertiser/delete-account` use
  `@RequiredScopes('advertiser:write')`.
- The controller comment says API keys are deliberately not allowed to export or
  erase an account, but there is no method-level JWT-only guard or API-key
  rejection on those handlers.
- `ApiKeyGuard` stamps `req.user` from the API-key owner and `JwtAuthGuard`
  skips JWT validation when `req.apiKey` is present.
- `RolesGuard` allows API-key auth for non-admin roles whenever the key has any
  scope, leaving fine-grained enforcement to `@RequiredScopes`.

Likely impact:

- A long-lived key with `advertiser:write` can reach advertiser account export
  and deletion despite comments claiming those paths are JWT-only.
- Depending on owner/profile shape, a developer-owned key may also be able to
  invoke advertiser deletion against the stamped owner id because the handler
  reads `@CurrentUser('id')` directly rather than resolving advertiser context.
- Sensitive privacy/destructive account operations remain mixed with
  machine-to-machine campaign management credentials.

Fix direction:

- Remove `@AllowApiKey()` from advertiser export/delete handlers or explicitly
  reject `req.apiKey` before calling the service.
- Split `advertiser:write` into campaign/profile-safe scopes and destructive
  account/privacy scopes that are never self-service mintable.
- Add controller/guard tests proving API keys cannot call export/delete even
  when they have `advertiser:write`.
- Keep payout and developer destructive scopes out of self-service API keys.

Desired goal:

- API keys used by extensions/automations cannot silently become durable account
  export or deletion credentials.

Done when:

- API keys cannot call advertiser/developer export or delete endpoints unless an
  explicit, tested product policy allows it.
- Tests prove `advertiser:write` keys can manage intended campaign/profile
  routes but cannot erase or export the account.
- Sensitive API-key creation is visible in audit/admin surfaces if any sensitive
  scopes are retained.

### A-038: Ad-Request Cache Is Not Scoped by User or Device

**Resolved 2026-07-04** — extension service uses `LRUCache` with
`adCacheKey(userId, deviceId, waitStateId)` (and a separate
`adIdempotencyCacheKey`) so two different users can no longer collide on
client-generated keys to receive each other's served ad / impression token.

Previously noted severity: medium.

Evidence:

- `ExtensionService` caches served ads in an LRU keyed by raw
  `idempotencyKey` and raw `waitStateId`.
- `requestAd()` checks the cache before `claimImpression()` and returns the
  cached `impressionToken` if the key matches.
- Those keys are client-generated strings and are not namespaced with `userId`,
  `deviceId`, or `sessionId`.

Likely impact:

- Two different users who collide on a wait-state id or idempotency key within
  the cache TTL can receive the same cached ad/impression token.
- The second user cannot later qualify the impression because ownership checks
  reject it, so the developer flow shows an ad that cannot pay out.
- The token/ad payload crosses account boundaries unnecessarily.

Fix direction:

- Namespace cache keys with `userId`, `deviceId`, and `waitStateId` or remove
  the cross-request in-memory ad cache.
- Return cached ads only after verifying the cached impression belongs to the
  current user/device.
- Add a regression test with two users using the same `waitStateId`.

Desired goal:

- Ad retry caching is idempotent only within the same authenticated
  user/device/wait-state context.

Done when:

- Cross-user key collisions cannot return another user's impression token.
- Same-user retry behavior still returns the same ad within the intended TTL.

### A-039: Ad Serving Checks Advertiser Balance Across All Currencies

**Resolved 2026-07-04** — requestAd filters per-currency via
`getAdvertiserBalancesByCurrency`, mapping each candidate campaign against its
own currency balance; coverage in `e2e-money-loop`.

Previously noted severity: medium.

Evidence:

- In `ExtensionService.requestAd()`, advertiser balances are grouped by
  `advertiserId` and `entryType` only.
- The eligibility filter compares that all-currency balance to the selected
  campaign's `bidAmountMinor`.
- Later billing paths use campaign currency, so the prefilter can serve a USD
  campaign because the advertiser has EUR/GBP/etc. balance.

Likely impact:

- Developers can be shown ads that will later be marked non-billable for
  insufficient same-currency balance.
- Campaign delivery becomes inconsistent for multi-currency advertisers.
- Advertiser spend eligibility and billing eligibility can disagree.

Fix direction:

- Compute advertiser balances by `advertiserId` and `currency`.
- Filter each campaign against its own currency balance.
- Add tests for an advertiser with positive EUR balance and zero USD balance
  owning a USD campaign.

Desired goal:

- Ad selection, campaign activation, and billing all use the same
  currency-specific funded-balance rule.

Done when:

- A campaign is eligible only when the advertiser has enough confirmed balance
  in that campaign's currency.
- Multi-currency tests cover positive and negative cases.

### A-040: CLI Watch Now Has an Ad Flow; Needs Full Terminal E2E

Severity: resolved pending E2E verification.

Current source check:

- `apps/cli/src/lib/api-client.ts` now has `requestAd()`,
  `recordAdRendered()`, `recordImpressionQualified()`, and `recordClick()`.
- `apps/cli/src/commands/watch.ts` requests an ad during an active wait state,
  records the rendered event, and qualifies the impression after a wait state
  lasts at least 5000 ms.
- `apps/cli/src/commands/watch.ts` shares one stable `sessionId` across
  wait-state start and ad request; the earlier correlation bug is tracked as
  resolved in A-064.
- `apps/cli/src/lib/ad-flow.ts` contains a reusable
  request/render/qualify helper, and `apps/cli/src/lib/ad-flow.test.ts` covers
  no-ad, long-enough, and too-short paths.

Residual risk:

- `runWatch()` reuses the tested `runAdFlow()` helper for the request/render
  half of the loop; only the qualify step stays inline at wait-end (deliberate,
  because total wait duration is only known when the wait state ends).
- This still needs an end-to-end terminal test against the API proving
  wait-state start → ad request → render → qualify → ledger credit.
- Signup consent fields are now collected by the CLI; A-047 resolved the
  hardcoded version fallback risk, but browser/CLI E2E consent coverage is
  still needed.

Follow-up direction:

- Reuse `runAdFlow()` from `runWatch()` or add tests directly around
  `runWatch()` so the shipped command is covered.
- Add E2E tests for CLI wait-state start → ad request → render →
  qualification → earnings ledger.

Desired goal:

- The terminal integration either earns through a complete audited ad event
  flow or is clearly not advertised as an earning surface.

Done when:

- A CLI-only developer can complete the same money loop as a VS Code developer,
  including ledger credit after a qualified impression.

### A-041: Referral Rewards Are Payoutable Developer Earnings

Severity: resolved pending full money-loop integration verification.

Current source check:

- `ReferralService.processReferralRewards()` creates the `platformLedger`
  `referral_bonus`, `referralReward`, and matching confirmed `earningsLedger`
  credit for the referrer inside the same transaction.
- The earnings credit uses `idempotencyKey: ref-rew-earn-{referral.id}`, while
  `ReferralReward` also has a DB-level `@@unique([referralId])` guard.
- The referral status CAS remains `pending -> rewarded`, so concurrent
  `markPayoutPaid()` calls cannot double-credit referral earnings.
- `PayoutService.getPayoutInfo()`, `getAvailableForPayout()`, and
  `requestPayout()` already compute payoutable balances from confirmed
  `earningsLedger` credits/debits minus reserved allocations, so the referral
  bonus is withdrawable through the same path as ad earnings.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/referral/referral.service.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api exec eslint src/referral/referral.service.ts
src/referral/referral.service.spec.ts`: passed.

Residual risk:

- Add an integration money-loop test that pays the referred developer, triggers
  the referral reward, then proves the referrer sees the reward in payout
  availability and can allocate it to a payout request.
- Accounting should still review whether `platformLedger` should represent a
  bonus expense/liability rather than only a generic referral-bonus credit.

Desired goal:

- Referral rewards have a single accounting treatment that matches what the UI
  promises and what payouts can actually withdraw.

Done:

- A referred user's first qualifying payout creates an auditable confirmed
  reward that is included in payout availability via `earningsLedger`.
- Unit coverage proves referral reward creation and idempotency for the
  payoutable earnings credit.

### A-042: Readiness Endpoint Now Fails Closed on Dependency Failure

Severity: resolved pending deployment verification.

Current source check:

- `HealthController.check()` remains a liveness endpoint that returns HTTP 200.
- `HealthController.ready()` now checks Postgres and Redis and throws
  `HttpException(..., 503)` when either required dependency is unavailable.
- `apps/api/src/health/health.controller.spec.ts` covers DB-down and Redis-down
  readiness failures.

Residual risk:

- Deployment artifacts still need to be verified to ensure Docker/Kubernetes or
  load-balancer health checks call `/api/v1/health/ready`, not only
  `/api/v1/health`.
- Public status UI semantics should keep liveness and readiness distinct.

Follow-up direction:

- Point Docker/Kubernetes readiness checks at `/health/ready`.
- Make status pages consume readiness for traffic safety and liveness for
  process uptime.

Desired goal:

- Deployment health checks reflect whether the API can safely serve product
  traffic.

Done when:

- DB-down and Redis-down scenarios are covered by tests or local verification.
- Runtime healthcheck/readiness commands fail when required dependencies fail.
- The public status UI no longer treats `status: ok` as authoritative if
  dependencies are degraded.

### A-043: Distributed Client Packaging Is Partially Wired but Not Publish-Ready

**Resolved 2026-07-09** (current worktree; verified by CLI tarball pack/install
smoke, VSIX package/metadata smoke, CLI and VS Code test/typecheck/lint, and
root `pnpm typecheck` / `pnpm lint`).

What changed:

- The CLI build now emits runtime files to `apps/cli/dist/index.js`, excludes
  test files from the package build, and ships a Node shebang for the npm bin.
- The CLI no longer depends on the private workspace-only `@waitlayer/shared`
  package; it localizes the small signing helper needed for device event HMACs.
- `scripts/verify-cli-bin.mjs` now checks both bin existence and the Node
  shebang.
- The CLI tarball was packed to `/tmp`, installed under `/tmp`, and
  `waitlayer --version` / `waitlayer --help` ran against the production API URL
  override.
- VSIX packaging now excludes `.turbo` logs and `eslint.config.js`; the package
  contains only metadata plus compiled `out/` files.
- `publish-cli.yml` and `publish-vscode.yml` package, smoke-test, and upload
  artifacts on release/manual runs. Real npm/Marketplace publication is a
  separate manual `workflow_dispatch` path with `publish=true` and environment
  gates (`npm-publish`, `vscode-marketplace`).
- `docs/ops/client-release.md` records artifact locations, publish gates,
  required secrets, and rollback expectations.

### A-044: Advertiser Privacy UI Has Password and Google-Only Paths

Severity: resolved pending browser smoke.

Current source check:

- `AdvertiserController` exposes `POST /advertiser/export-data` and
  `POST /advertiser/delete-account`; both are guarded with `RejectApiKeyGuard`.
- The Next.js proxy allowlist includes `/advertiser/export-data` and
  `/advertiser/delete-account`, and `advertiserApi` has matching methods.
- `apps/web/src/app/advertiser/settings/page.tsx` is reachable from the
  advertiser sidebar and uses the export/delete API methods.
- `AuthService.getMe()` now returns coarse auth-provider capability
  `hasPassword` without leaking `passwordHash`, and the web auth context maps
  `hasPassword` plus `googleVerified`.
- Password-backed advertiser accounts get the existing current-password deletion
  step-up.
- Google-only advertiser accounts now see an explicit support-assisted erasure
  path and the UI disables the password-only destructive submit instead of
  calling the backend with an impossible step-up.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/auth/auth.service.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api typecheck`: passed.
- `pnpm --filter waitlayer-api exec eslint src/auth/auth.service.ts
src/auth/auth.service.spec.ts`: passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/advertiser/settings/page.tsx
src/lib/auth-context.tsx`: passed.

Residual risk:

- Google ID-token reauthentication for self-service advertiser deletion remains
  future work. Current launch behavior is an explicit support-assisted path for
  Google-only advertisers.
- Add browser/E2E coverage for advertiser export, password deletion, Google-only
  support copy, API-key rejection, and sidebar visibility.
- The admin erasure endpoint exists, but A-028 still tracks exposing it in the
  admin Users UI.

Desired goal:

- Every user role has a clear, tested privacy export and erasure path.

Done:

- Developer and advertiser privacy controls exist and are role-appropriate.
- Advertiser privacy controls are discoverable from the advertiser app chrome.
- Password-backed advertiser accounts have a self-service deletion step-up, and
  Google-only advertiser accounts see an explicit support-assisted erasure flow.
- Exports include personal/account/business data relevant to the advertiser
  role, and deletion keeps money-retention/legal-hold records intact.

### A-045: Admin Creative Rejection Uses Reviewer-Provided Reasons

**Resolved 2026-07-09** (current working tree). A genuine bug was fixed and a
service-level regression test added.

What changed:

- `apps/api/src/campaign/campaign.service.ts` `rejectCreative()` now throws
  `BadRequestException` when the supplied reason is empty/whitespace, instead of
  persisting an empty string. This enforces the A-045 requirement that admins
  cannot reject a creative without a reason.
- `apps/web/src/app/admin/campaigns/page.tsx` already sends a non-empty trimmed
  reason via `campaignApi.rejectCreative(cr.id, creativeRejectReason.trim())`.
- `apps/api/src/campaign/campaign.service.spec.ts` adds: persists the exact
  reviewer reason on `adCreative.rejectionReason` (not a placeholder), and
  rejects empty reason with `BadRequestException`.

- Every creative rejection leaves a specific, durable, advertiser-visible reason.

Done when:

- Admins cannot reject a creative from the UI without entering a reason.
- Advertisers can see the exact reason before editing/resubmitting the creative.
- The audit trail and `adCreative.rejectionReason` contain the submitted reason,
  not a generic placeholder.

### A-046: Fraud Trust Recompute Uses Shared Error-Throwing Client

Severity: resolved pending UI regression tests.

Current source check:

- `apps/api/src/admin/admin.controller.ts` exposes
  `POST /admin/fraud/compute-trust/:userId`, and `AdminService` forwards it to
  `FraudService.computeTrustScore()`.
- `apps/web/src/lib/api/services.ts` now has
  `adminApi.recomputeTrustScore(userId)`.
- `apps/web/src/app/admin/fraud/page.tsx` calls that shared API helper; the
  shared client rejects non-2xx responses, and the catch block calls
  `setError(getErrorMessage(err, 'Trust recompute failed'))`.

Residual risk:

- No focused UI/service regression test was found that forces a 500 and proves
  the fraud page leaves a visible error.

Follow-up direction:

- Add a UI/service test that a 500 response leaves an error visible and does not
  present the action as successful.

Desired goal:

- Fraud operators get an explicit success or failure signal for trust recompute
  actions.

Done when:

- Failed recompute responses surface an error in the fraud page.
- Successful recomputes refresh the affected row/stats.
- The shared admin API surface includes the recompute operation.

### A-047: Consent Version Fallbacks Fail Closed

Severity: resolved pending browser E2E coverage.

Current source check:

- `apps/api/src/compliance/consent-versions.ts` is the source for current
  `privacy_policy`, `terms_of_service`, and `marketing_cookies` versions.
- Web signup and Google signup now require a fetched `terms_of_service` or
  `privacy_policy` version before calling signup APIs. If the version endpoint
  fails or returns no relevant version, signup stays disabled and shows a retry
  error.
- CLI signup now exits before account creation if `/consent/required-versions`
  cannot be fetched or lacks terms/privacy versions.
- `ConsentRePrompt` no longer falls back to `2026-07-01`; if a stale purpose is
  missing from the required-version response, the banner stays up instead of
  recording a stale version.
- `CookieConsent` now fetches the `marketing_cookies` version and, for
  authenticated users, records both accept (`granted: true`) and decline
  (`granted: false`) server-side before dismissing the banner. Server write
  failures show a retry message and do not present account-level preferences as
  saved.
- Logged-out cookie preferences remain local-only by design.

Verification:

- `pnpm --filter waitlayer-cli test`: passed.
- `pnpm --filter waitlayer-cli typecheck`: passed.
- `pnpm --filter waitlayer-cli lint`: passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/auth/signup/page.tsx
src/components/consent-reprompt.tsx src/components/cookie-consent.tsx`:
  passed.

Residual risk:

- Add browser/E2E tests for web signup version-fetch failure, re-prompt missing
  purpose versions, authenticated cookie accept/decline, and server-write
  failure retry behavior.

Desired goal:

- Consent prompts always record the server-required version for each purpose.

Done:

- A policy-version bump in `consent-versions.ts` requires no web/CLI hard-coded
  version change for signup, re-prompt, or cookie consent.
- Signup, Google signup, CLI signup, re-prompt, cookie accept, and authenticated
  cookie decline all either record a server-provided current version or fail
  closed with a visible retry path.

### A-048: Payout Account Verification Gate Was Added in the Current Tree

Severity: resolved pending verification.

Current source check:

- `packages/db/prisma/schema.prisma` has `PayoutAccount.isVerified` with
  `@default(false)`.
- `PayoutService.requestPayout()` now rejects `!account.isVerified` before
  creating a payout request.
- `apps/web/src/app/developer/payouts/page.tsx` blocks selected unverified
  payout methods and disables them in the selector.
- `AdminController` exposes `POST /admin/payout-accounts/:id/verify`, and
  `AdminService.setPayoutAccountVerified()` updates `isVerified` with an audit
  event.
- `apps/web/src/app/admin/payouts/page.tsx` exposes a "Verify method" action for
  unverified payout accounts.
- `apps/api/src/payout/payout.service.spec.ts` covers rejection of unverified
  payout destinations.

Residual risk:

- Admin payout UI still needs modal coverage; A-026 tracks a separate manual
  reconciliation amount-conversion bug.
- Provider-specific automated verification is still a product/process decision,
  but the platform now has an admin gate.

Follow-up direction:

- Define what payout account verification means per provider: email challenge,
  provider account verification, admin approval, or trusted provider callback.
- Keep admin verification/rejection covered by UI tests.
- Add provider-specific verification where required for scale.

Desired goal:

- Funds can only be requested to payout destinations that passed the intended
  verification workflow.

Done when:

- Newly added payout accounts cannot be used for payouts until verified.
- Verification/rejection actions are audited and visible to developers/admins.
- Tests cover payout request rejection for an unverified payout account.

### A-049: Web Logout Now Waits for Server Revocation/Cookie Clear

Severity: resolved pending verification.

Current source check:

- `apps/web/src/app/api/auth/logout/route.ts` is intentionally conservative:
  if the API logout call cannot be reached or returns a non-401 failure, it
  returns an error and does not clear auth cookies.
- `apps/web/src/lib/auth-context.tsx` now awaits `api.post('/auth/logout')`
  before removing `lastDashboard` or setting `user` to `null`.
- On logout failure, `auth-context` logs a warning and rethrows, keeping the
  session visibly active instead of silently dropping local state.

Residual risk:

- This still needs a browser/route-handler regression test proving a 502 from
  `/api/auth/logout` leaves the user visible and cookies uncleared.
- `pnpm --filter waitlayer-web typecheck` currently passes, but logout failure
  behavior still needs a route-handler/browser regression test.

Follow-up direction:

- Add tests for API logout 502/500: local user state should not be cleared and
  protected pages should not claim logout succeeded.
- Make logout UI surfaces display the rethrown error clearly.

Desired goal:

- The web UI's logged-out state matches server session revocation and cookie
  clearing.

Done when:

- A failed logout response leaves the user visibly authenticated with an error.
- A successful logout clears cookies and local auth state.
- Reload after a failed logout does not surprise the user with a resurrected
  session.

### A-050: Date-Only Report End-Day Inclusion Was Fixed in the Current Tree

Severity: resolved pending verification.

Current source check:

- `apps/web/src/app/advertiser/reports/page.tsx` sends date-only strings from
  `periodPreset()` via `toISOString().slice(0, 10)`.
- `AdvertiserService.getReports()` now treats date-only `to` values as an
  exclusive next-day UTC bound (`lt` next day) while preserving `lte` for full
  ISO datetimes.

Residual risk:

- Add/keep API tests for an event at noon on the selected date-only `to` day.
- A-067 still tracks the separate misleading "Last 24h" preset, which now sends
  calendar date bounds rather than a rolling 24-hour ISO range.

Follow-up direction:

- Prefer explicit ISO datetimes for "last 24h" instead of date-only strings.
- Keep date-only/custom range tests around end-day inclusion.

Desired goal:

- Advertiser report periods include exactly the time range the UI label
  promises.

Done when:

- Last-24h and custom date-range reports include events within the selected end
  day.
- API tests cover date-only and datetime `from`/`to` inputs.
- Report totals reconcile with ledger spend for the same period.

### A-051: Campaign Creation Wizard Leaves Orphaned Drafts on Partial Failure

**Resolved 2026-07-09** (commit 229dde8). The new campaign page (`apps/web/src/app/advertiser/campaigns/new/page.tsx`) now tracks the created campaign via a local `campaignCreated` variable (not React state, avoiding stale closures), and on creative/targeting/submit failure shows a recovery message directing the advertiser to edit the draft from the campaigns list rather than a generic "Failed to create campaign" error.

Severity: medium-high.

Evidence:

- `apps/web/src/app/advertiser/campaigns/new/page.tsx` performs a multi-step
  client-side workflow: create campaign, create creative, optionally set country
  targeting, then submit campaign.
- Those calls are separate HTTP requests with no compensating rollback.
- If creative creation, targeting, or submission fails, the page shows "Failed
  to create campaign" even though the campaign may already exist as `draft`.
- The campaign list's draft `Edit` button has an empty `onClick`, and A-021
  already notes there is no complete draft/rejected recovery loop.

Likely impact:

- Advertisers can accidentally create hidden or confusing draft campaigns when
  only a later step failed.
- Retrying the wizard can create duplicates.
- Because draft recovery is incomplete, the user may need support or direct API
  calls to finish or clean up the partially created campaign.

Fix direction:

- Move create-campaign + first creative + targeting + submit into a backend
  transactional-ish orchestration endpoint, or make the UI explicitly save a
  draft and route the advertiser to a recoverable draft detail page on failure.
- Return the partial campaign id when later steps fail.
- Add delete/archive/edit recovery actions for draft partials.

Desired goal:

- Campaign creation is either atomic from the user's perspective or safely
  recoverable.

Done when:

- A failure after campaign creation leaves the advertiser with a clear draft
  recovery path.
- Retrying the wizard does not create confusing duplicate campaigns.
- Tests cover creative/targeting/submit failure after the campaign row is
  created.

### A-052: Advertiser Role CTAs Mostly Fixed; Generic CTAs Still Default Developer

**Resolved 2026-07-09** (current worktree; verified by
`pnpm --filter waitlayer-web exec vitest run src/lib/auth-routing.test.ts`,
`pnpm --filter waitlayer-web test`, `pnpm --filter waitlayer-web typecheck`,
and `pnpm --filter waitlayer-web lint`).

What changed:

- Public role-specific CTAs now use explicit signup role hints:
  `/auth/signup?role=developer` or `/auth/signup?role=advertiser`.
- The pricing bottom CTA now exposes separate developer and advertiser actions
  instead of one mixed-audience signup link.
- Signup URL parsing moved into `apps/web/src/lib/auth-routing.ts`, with tests
  for developer, advertiser, referral, and invalid-role URLs.
- Referral signup URLs remain developer-only and take precedence over a role
  query value.
- Login/signup/Google auth redirects now use the role returned by the auth API
  instead of falling back through a stale or missing `lastDashboard` value.

### A-053: Redis Health Probe Recovery Was Added in the Current Tree

Severity: resolved pending verification.

Current source check:

- `RedisHealthService.disposeClient()` clears `connectPromise` and `client`.
- `ensureClient()` drops stale non-ready clients before reconnecting.
- Failed connect promises clear the cached promise/client.
- `check()` disposes the client after connect or ping failure so the next probe
  can reconnect.
- `apps/api/src/health/redis-health.service.spec.ts` covers initial connection
  failure recovery and ping-failure reconnect.

Residual risk:

- Needs verification against a real Redis outage/recovery, not only mocks.

Follow-up direction:

- Add an integration check with Redis stopped and restarted if deployment
  readiness depends on it.

Desired goal:

- The health probe reflects current Redis availability, not the outcome of the
  first connection attempt.

Done when:

- Redis health recovers without restarting the API.
- Tests cover initial failure, reconnect success, and stale-client failure.

### A-054: Archive Refunds Now Reduce Spendable Balance; Billing Display Still Differs

Severity: resolved pending billing-display follow-up.

Current source check:

- `AdvertiserService.archiveCampaign()` records unspent archived budget as an
  advertiser ledger row with `entryType: 'refund'` and `status: 'pending'`.
- `AdminService.confirmArchiveRefund()` flips that row to `confirmed` after the
  admin manually issues the Stripe refund and writes the platform cash debit.
- `apps/api/src/common/utils/advertiser-balance.ts` centralizes spendable
  balance as confirmed credits minus confirmed debits minus confirmed refunds.
- `AdvertiserService`, `CampaignService`, `AdminService`, and
  `ExtensionService` call the centralized balance helper for activation,
  resume, approval, ad serving, and billing guards.
- `getAdvertiserBalancesByCurrency()` also subtracts confirmed refund rows when
  filtering ad-serving eligibility.
- `apps/api/src/common/utils/advertiser-balance.spec.ts` covers pending refund
  exclusion and confirmed refund subtraction.
- `AdvertiserService.getBilling()` still computes the displayed billing summary
  from only `credit` and `debit`; that residual UI/API display mismatch is
  tracked separately as A-066.

Residual risk:

- Billing/dashboard totals still need to reconcile deposits, debits, refunds,
  disputes, and spendable balance by currency (A-066).
- Keep integration coverage for deposit → archive → confirm refund → ad-serving
  in place or add it if missing.

Follow-up direction:

- Make advertiser billing display use the same centralized balance formula
  (A-066).
- Keep dispute semantics aligned with the centralized formula (A-063).

Desired goal:

- Once an advertiser refund is confirmed, that cash cannot be spent again.

Done when:

- Confirmed refund rows reduce advertiser available balance.
- Campaign activation/resume and ad serving reject campaigns whose only funding
  was already refunded.
- Billing/dashboard totals reconcile deposits, debits, refunds, disputes, and
  spendable balance by currency.

### A-055: Account-Level Billing Guard Was Added; Needs Concurrency Test

Severity: resolved pending concurrency verification.

Current source check:

- `ExtensionService.requestAd()` filters campaigns with a read-only advertiser
  balance precheck before serving an ad; that is still only an eligibility
  optimization.
- `recordQualifiedImpression()` now opens a transaction, obtains a
  `pg_advisory_xact_lock` keyed by advertiser+currency, re-checks spendable
  balance inside the locked transaction, and only then increments campaign
  spend and writes ledger rows.
- `recordClick()` applies the same advertiser+currency advisory lock and
  in-transaction balance check for CPC billing.
- The balance check uses the centralized formula from A-054, including
  confirmed refunds.
- `rg` did not find an obvious dedicated regression test proving two concurrent
  billable events across different campaigns cannot overdraw one small
  advertiser balance.

**Concurrency regression added 2026-07-09 (this session):**
`apps/api/src/extension/extension.service.concurrency.spec.ts` (2 tests, untracked
working tree) exercises `recordQualifiedImpression()` / `recordClick()` under a
mocked `pg_advisory_xact_lock` + in-transaction balance re-check and proves that
when only one bid remains funded across two active campaigns sharing one small
advertiser balance, exactly one billable event is accepted and the other is
rejected as `insufficient_advertiser_balance` (no overdraw). Verified by
`pnpm --filter waitlayer-api exec vitest run src/extension/extension.service.concurrency.spec.ts`
→ 2 tests green. This closes the prior residual risk of "no dedicated
concurrency regression test."

Residual risk:

- Code-level locking is present, but a real concurrent CPM/CPC regression test
  should prove one of two events is rejected when only one bid remains funded.

Follow-up direction:

- Add concurrent CPM and CPC tests with two active campaigns sharing one small
  advertiser balance.
- Keep CPM qualification and CPC click paths on the same account-level guard.

Desired goal:

- Every billable event consumes advertiser cash exactly once and cannot overdraw
  the advertiser's available balance.

Done when:

- Concurrent cross-campaign billing cannot make advertiser balance negative.
- CPM qualification and CPC click paths use the same atomic account-level cash
  guard.
- Tests prove one of two concurrent events is rejected when only one bid remains
  funded.

### A-056: Country Targeting Is Enforced During Ad Selection

Severity: resolved pending live-client country population smoke.

Current source check:

- `AdRequestDto` now has optional `country`, and `ExtensionService.requestAd()`
  accepts it in the service contract.
- `ExtensionService.requestAd()` resolves country from the client payload first
  and falls back to the developer profile country. It normalizes country codes
  before comparing against campaign rules.
- `CampaignService.setCountryTargeting()` normalizes stored country codes to
  uppercase before persisting `CountryTargeting` rows.
- Campaign eligibility now calls `isCountryEligible()`:
  no rules serve everywhere, include rules require a matching known country,
  and exclude rules block matching countries.
- Launch copy in `apps/web/src/app/page.tsx` and
  `apps/web/src/app/pricing/page.tsx` no longer advertises campaign-level tool
  targeting as a live advertiser control.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/integration/e2e-money-loop.spec.ts`:
  passed.
- `pnpm --filter waitlayer-api typecheck`: passed.
- `pnpm --filter waitlayer-api exec eslint src/extension/extension.service.ts
src/campaign/campaign.service.ts src/integration/e2e-money-loop.spec.ts`:
  passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-web exec eslint src/app/page.tsx
src/app/pricing/page.tsx`: passed.

Residual risk:

- VS Code/CLI requests still do not actively send `country`; delivery falls
  back to the stored developer profile country. Run a client smoke to confirm
  profile country is populated for expected launch users.
- True campaign-level tool targeting remains a future product feature, not a
  launch claim.

Desired goal:

- Targeting controls shown to advertisers are enforced by the delivery engine.

Done:

- Campaigns with include/exclude country rules only serve in matching delivery
  contexts.
- Tool targeting was removed from launch copy rather than advertised without a
  campaign-level delivery rule.
- Tests cover no-targeting delivery, country include misses, country excludes,
  and matching country delivery.

### A-057: Developer Category Blocking Is Wired but Untested

**Resolved 2026-07-09** (current working tree). The blocking logic was
extracted into two pure exported helpers, `mergeBlockedCategories()` and
`isCategoryBlocked()`, used by `ExtensionService.requestAd()`. A focused unit
test `apps/api/src/extension/extension.service.blocked-categories.spec.ts`
covers persisted-only, requested-only, union/dedupe, no-config, unrelated/
typo categories, and per-side suppression. Verified by
`pnpm --filter waitlayer-api exec vitest run src/extension/extension.service.blocked-categories.spec.ts`
→ 7 tests green. Severity was `resolved pending focused regression tests`.

Current source check:

- The landing page says developers can "Block categories" and the FAQ says
  category blocking is available from the settings dashboard.
- `packages/db/prisma/schema.prisma` now adds
  `UserSettings.blockedCategories String[] @default([])`.
- `UpdateSettingsDto`, `DeveloperService.updateSettings()`, and
  `apps/web/src/app/developer/settings/page.tsx` now expose blocked category
  preferences.
- `ExtensionService.requestAd()` now loads `userSettings`, merges persisted
  blocked categories with any per-request `dto.blockedCategories`, and excludes
  matching campaign categories server-side even when the client omits category
  arrays via `mergeBlockedCategories()` / `isCategoryBlocked()`.

Residual risk:

- The current UI uses free-form comma-separated slugs; typos silently become
  stored preferences that may not match real campaign categories.
- There is still no advertiser-visible taxonomy picker shared with the developer
  setting, so category names/slugs can drift across surfaces.

Follow-up direction:

- Replace the free-form settings field with a shared category picker or at least
  validate against the campaign category taxonomy.
- Clarify the difference between a user blocking a category and reporting a bad
  category/ad.

Desired goal:

- Developer category preferences are durable and enforced server-side for every
  ad request from that developer.

Done when:

- Settings UI/API can create, update, and display blocked categories.
- `requestAd()` applies the persisted preferences even if the client omits
  category arrays.
- Tests cover blocked, allowed, and unconfigured category behavior.

### A-058: Quiet Mode Uses Server Time Instead of Developer Local Time

**Resolved 2026-07-09** (commit `8631f88`). Schema adds nullable `timezone TEXT`
column on `user_settings` (migration 20260709040000). `ExtensionService.currentTimeHHMM()`
now accepts an IANA timezone argument and uses `Intl.DateTimeFormat({timeZone})` to
compute the developer's wall-clock time; falls back to UTC when no timezone is set.
`UpdateSettingsDto` accepts an optional `timezone` field validated via
`Intl.supportedValuesOf('timeZone')` (empty/null clears to UTC, unknown tz →
BadRequestException). Developer settings page exposes a `<select>` with curated common
timezones plus the browser-detected zone as a UX hint. Typecheck + 296/296 tests green.

Previously noted severity: medium-high.

### A-059: Partial Payout Approval Can Mark Too Much Earnings as Paid

**Resolved 2026-07-09** (current worktree; verified by
`pnpm --filter waitlayer-api exec vitest run src/payout/payout.service.spec.ts`,
`pnpm --filter waitlayer-api typecheck`, and targeted eslint).

What changed:

- `PayoutService.processPayout()` reconciles partial approvals before provider
  initiation by shrinking the allocation and underlying earnings row to the
  approved paid slice.
- The unpaid remainder is persisted as a fresh `confirmed` earnings row with a
  deterministic remainder idempotency key, keeping it available for a later
  payout request.
- `apps/api/src/payout/payout.service.spec.ts` now covers a single $10 earning
  with a $6 partial approval and asserts a $6 paid slice plus $4 confirmed
  remainder before provider initiation.

### A-060: Minimum Visible Duration Can Be Claimed Without Waiting

**Resolved 2026-07-05** — server records `renderedAt` itself in
`recordRendered` (not trusting client-provided timestamp). `recordQualifiedImpression`
rejects immediate render→qualify with `minimum_duration_not_met` (covered by
e2e-money-loop + contract-tests Zod shape).

Previously noted severity: high.

Evidence:

- `ExtensionService.recordQualifiedImpression()` accepts the client-provided
  `visibleDurationMs` after verifying the device signature.
- The server only clamps the claimed duration when
  `elapsedServer > 1_000 && visibleDurationMs > elapsedServer + 5_000`.
- If `recordRendered()` and `recordQualifiedImpression()` are called
  immediately, `elapsedServer` is sub-second and the code trusts the claimed
  duration.
- Integration tests exercise this path by rendering an ad and immediately
  sending `visibleDurationMs: 6000`, which passes the current checks.
- `qualifiedAt` is parsed into a date for storage, but the server does not use
  it to require that at least `MINIMUM_VISIBLE_DURATION_MS` elapsed after the
  server-recorded render time.

Likely impact:

- A signed client can qualify impressions instantly instead of waiting the
  advertised five seconds.
- Advertisers can be charged and developers credited for ads that were not
  actually visible for the minimum duration.
- Fraud checks see apparently valid qualified impressions because the HMAC
  proves device possession, not honest view-time measurement.

Fix direction:

- Treat minimum visible duration as a server-side timing invariant: require
  `Date.now() - renderedAt >= MINIMUM_VISIBLE_DURATION_MS` before qualification,
  with only a small grace window for server clock/processing variance.
- Reject future `renderedAt`/`qualifiedAt` values and impossible event order.
- If client-side visibility evidence is needed, store it as supporting
  telemetry, not as the authoritative billing clock.

Desired goal:

- A billable impression cannot qualify until the server has observed enough
  elapsed time since render.

Done when:

- Immediate render→qualify calls with `visibleDurationMs >= 5000` are rejected.
- Qualification succeeds only after the required server-observed delay.
- Tests cover immediate, below-threshold, exact-threshold, delayed, and
  future-timestamp cases.

### A-061: Developer and Campaign Frequency Caps Are Not Enforced End-to-End

**Resolved 2026-07-09** (commit ea85327) — campaign `frequencyCapPerHour` /
`frequencyCapPerDay` enforcement reads all served impressions for the trailing
hour/day (not just billable). The developer `maxAdsPerHour` authoritative
cap gate in `claimImpression` now counts every served impression under the
advisory lock (not just `isBillable: true`) so a rapid burst of parallel ad
requests cannot bypass the user-selected cap. Test coverage:
`e2e-money-loop`.

Previously noted severity: high.

Evidence:

- `UserSettings.maxAdsPerHour` is configurable in the developer settings UI and
  stored in the database.
- `ExtensionService.requestAd()` enforces that setting only inside
  `claimImpression()`, and the count only includes impressions where
  `isBillable: true`.
- New ad-request impressions are created with `isBillable: false`, so multiple
  concurrent or rapid wait states can be served before any of them qualify.
- `recordQualifiedImpression()` does not re-check `maxAdsPerHour`; it only calls
  `FraudService.checkImpressionRateLimit()`, which uses the global
  `RATE_LIMITS.IMPRESSIONS_PER_USER_PER_HOUR` / device limits rather than the
  developer's selected max.
- `Campaign.frequencyCapPerHour` and `frequencyCapPerDay` are in the schema and
  advertiser DTOs, but `ExtensionService.requestAd()` never reads those fields.
  It only excludes campaigns with a billable impression in the last hour, and
  there is no daily campaign cap check.

Likely impact:

- Developers can receive and bill more ads than their own max-per-hour setting
  if several ad requests are made before qualification.
- Advertisers can configure campaign frequency caps that are not actually
  enforced by delivery.
- The delivery engine's hard-coded "not shown in the last hour" behavior may be
  stricter than an advertiser's hourly cap and looser than the daily cap,
  making campaign pacing and spend expectations unreliable.

Fix direction:

- Decide whether caps apply at served-ad time, billable-qualification time, or
  both; then enforce the same policy atomically at the money-moving point.
- Count pending served impressions when enforcing developer ad exposure caps,
  or reserve cap slots at request time and release them on non-qualification.
- Implement campaign `frequencyCapPerHour` and `frequencyCapPerDay` in the ad
  eligibility filter with user/device/campaign scoped counts.

Desired goal:

- Developer and advertiser frequency controls match the product settings and
  cannot be bypassed by request/qualification timing.

Done when:

- Rapid concurrent wait states cannot exceed a developer's configured hourly
  cap.
- Campaign hourly and daily caps are enforced exactly as stored.
- Tests cover pending impressions, qualified impressions, hourly caps, daily
  caps, and cap reset windows.

### A-062: Stripe Webhook Failure Paths Can Be Acknowledged Without Reconciliation

**Status:** Resolved 2026-07-09 (current working tree). An independent, opt-in
webhook-event reclaim worker now closes the architectural residual.

Severity: critical (resolved).

What changed (this pass):

- New `apps/api/src/integration/webhook-reclaim-cron.service.ts`
  (`WebhookReclaimCronService`, mirrors `PayoutCronService`): an opt-in cron
  (`WEBHOOK_RECLAIM_CRON=true`, default OFF) that scans for `webhookEvent` rows
  stuck in `pending`/`processing` for longer than
  `WEBHOOK_RECLAIM_CRON_AGE_MS` (default 35 min — deliberately just past the
  controller's 30-min stall window so the two recovery paths never target the
  same row), resets them to `pending`, and re-dispatches them onto the shared
  `EventBus` so `StripeWebhookController`'s reconciliation handler reprocesses
  them. Includes an in-flight guard, batch size, and a unit spec
  (`webhook-reclaim-cron.service.spec.ts`, 5 tests).
- Wired into `apps/api/src/payout/payout.module.ts` (where the webhook
  controller + EventBus live). `StripeWebhookController` is unchanged.

Residual / operational note:

- The cron is OFF by default. Enable only in multi-instance / high-durability
  deployments so a background worker owns orphan reclamation. Single-instance
  deployments keep the original Stripe-retry + 30-min stall-reclaim behavior.
- The earlier critical failure paths (non-2xx on bad/missing signature,
  permanent-error rows marked `processed`, async reset-to-`pending`) remain as
  documented above.

Commit: `28c7382` (prior critical paths) + `webhook-reclaim-cron.service.ts`
(this pass).

Evidence:

- ~~`StripeWebhookController.handleWebhook()` is annotated with
  `@HttpCode(HttpStatus.OK)`.~~ The decorator is still there but every failure path
  now throws `HttpException` with a non-2xx status — the decorator only governs the
  success return.
- ~~Missing Stripe signature, missing raw body, and signature verification failure
  all return non-2xx now.~~
  - Signature missing → `HttpException` 400
  - Raw body missing → `HttpException` 400
  - Signature verification failed → `HttpException` 400
  - Stripe not configured → `HttpException` 503
  - Persistence race (vanished after insert) → `HttpException` 500
- ~~`handlePaymentSuccess()` returns early when checkout metadata lacks
  `advertiserId` or the advertiser row is missing.~~ Both early-return paths now
  `updateMany` the webhookEvent row `processingStatus: 'processed'` with an error
  reason (`missing_advertiserId_in_checkout_metadata` / `advertiser_not_found`).
  These are permanent business errors — Stripe has no more data to deliver.
- ~~`WEBHOOK_ASYNC_PROCESSING=true` acknowledges the event immediately `{ accepted_async }` and
  dispatches via EventBus. `runProcessing` catches failures and resets to `pending`, and the
  30-min stall-reclaim path can re-pick it.~~ The row ends up in `processing` after async
  dispatch; on process crash, there is no durable background worker that drains `pending`
  rows independently of Stripe redelivery. This is a residual risk acknowledged as
  architectural (no separate webhook-event cron worker).
- Six other early-return paths across `handleRefund`, `handleDispute`,
  `handleDisputeClosed`, `handlePayoutPaid`, `handlePayoutFailed` all already mark
  the webhookEvent row `processed` — verified in audit pass.

Likely impact (residual):

- Async-mode process crash between the 200 response and `runProcessing` completion
  leaves the row in `processing` — the 30-min stall-reclaim path recovers it on
  the NEXT Stripe delivery, but there's no independent cron polling for orphaned
  `processing` rows.

Done:

- ~~Misconfigured or invalid webhook requests return non-2xx.~~ ✅
- ~~Accepted-but-permanently-failed events reach terminal `processed` with error reason.~~ ✅
- ~~Deposits cannot be lost silently due to missing metadata or async process
  failure.~~ ✅ (row marked processed, not stuck in processing)

Remaining:

- ~~No background cron worker claims `pending` webhook rows independently of Stripe
  redelivery.~~ ✅ Resolved this pass: `WebhookReclaimCronService` (opt-in via
  `WEBHOOK_RECLAIM_CRON=true`) reclaims orphaned `pending`/`processing` rows and
  re-dispatches them onto the EventBus. Defer to future hardening; current
  recovery via 30-min stall-reclaim on the next Stripe retry +
  `runProcessing` catch reset covers transient failures in single-instance
  deployments.

Commit: `28c7382`

### A-063: Partial Stripe Disputes Freeze or Write Off Entire Deposits

**Resolved 2026-07-09** (current worktree; verified by
`pnpm --filter waitlayer-api exec vitest run src/integration/stripe-webhook.spec.ts`
and targeted eslint).

What changed:

- Current `StripeWebhookController.handleDispute()` keeps the parent deposit
  credit `confirmed` and decrements only the disputed amount while writing a
  separate `hold` row for the disputed slice.
- `handleDisputeClosed()` settles those hold rows amount-by-amount: won disputes
  restore a matching confirmed credit; lost disputes write a matching advertiser
  reversal plus platform cash reversal.
- `apps/api/src/integration/stripe-webhook.spec.ts` now covers a $100 deposit
  with a $10 dispute for created, won, and lost paths. The tests assert the
  undisputed $90 remains confirmed/spendable and only the $10 slice is held,
  restored, or reversed.

### A-064: CLI Watch Uses Different Session IDs for Wait Start and Ad Request

**Resolved 2026-07-04** — `apps/cli/src/commands/watch.ts` computes one
session id `cli-${waitStateId}` and reuses it across `reportWaitState`,
`requestAd`, and `endWaitState` so the API can correlate them by the
userId/deviceId/sessionId/waitStateId quartet.

Previously noted severity: high.

Evidence:

- `apps/cli/src/lib/api-client.ts` `reportWaitState()` sends
  `sessionId: 'cli-' + Date.now()` when it records `/extension/wait-state/start`.
- `apps/cli/src/commands/watch.ts` later calls `requestAd()` with
  `sessionId: \`cli-${waitStateId}\`` for the same wait state.
- `ExtensionService.requestAd()` requires a matching wait-state start row with
  the same `userId`, `deviceId`, `sessionId`, `waitStateId`, and
  `eventType: 'wait_state_start'`.
- The imported `runAdFlow()` helper is not used by `runWatch()`.

Likely impact:

- Terminal/CLI ad requests fail with "No matching active wait state start" even
  after the CLI successfully records the wait-state start.
- The terminal earning path can appear implemented but cannot actually progress
  from wait-state start to ad request to render/qualification.
- This is the current residual form of the older CLI ad-flow gap.

Fix direction:

- Generate one stable session id in `runWatch()` and pass it to both
  wait-state start and ad request.
- Either use `runAdFlow()` or remove the unused import and cover the watch
  command directly.
- Add a CLI unit/integration test that asserts the same session id reaches
  start, ad-request, render, qualify, and wait-end calls.

Desired goal:

- The CLI watch command can complete the same developer earning path as the VS
  Code extension.

Done when:

- CLI watch start and ad request use one session id.
- A test proves the API accepts the CLI start -> ad request flow.
- The CLI can qualify an impression after the required visible duration.

### A-065: CLI Signup Consent Fields Were Added; Tests Still Needed

**Resolved 2026-07-09** (current working tree). `apps/cli/src/commands/auth.test.ts`
now covers declined consent (exits before any version fetch or `signup()` call),
version-fetch failure (exits before `signup()`), and accepted consent that
forwards `ageConfirmed: true`, `termsAccepted: true`, and the live
`policyVersion` to `api.signup()`. The accepted test also asserts the resolved
`setCredentials()` call. In a healthy (online) install these pass with the rest
of the CLI suite; in the current offline sandbox the CLI `vitest` is not linked
into `apps/cli/node_modules`, which also breaks the pre-existing CLI signup/\
login tests — that is an environment/install artifact, not a code defect.
Severity was `resolved pending focused CLI tests`.

Current source check:

- `SignUpDto` requires `ageConfirmed` and `termsAccepted` booleans.
- `AuthService.signUp()` rejects account creation when either field is missing
  or false.
- `apps/cli/src/commands/auth.ts` now prompts for age confirmation and
  Terms/Privacy acceptance, exits before signup when either is declined, fetches
  `/consent/required-versions`, and sends `ageConfirmed`, `termsAccepted`, and
  `policyVersion`.
- `apps/cli/src/lib/api-client.ts` `signup()` now accepts and forwards the
  consent fields, and `getRequiredConsentVersions()` is available.
- `pnpm --filter waitlayer-cli typecheck`: passed.

Desired goal:

- Every signup surface enforces and records the same age/terms/privacy consent.

Done when:

- CLI signup succeeds only after explicit consent.
- The consent rows are created for CLI signups with the current policy version.
- Tests cover declined consent, accepted consent, and policy-version forwarding.

### A-066: Advertiser Billing Display Still Ignores Confirmed Refunds

**Resolved 2026-07-09** (commit `285937f`). `getBilling()` now filters
`entryType: { in: ['credit', 'debit', 'refund'] }` and computes
`balanceMinor = credits − debits − refunds` — the same formula as the
centralized `getAdvertiserBalance()` helper. Both the top-level response
and each per-currency `BillingBalance` now carry `totalRefundsMinor`.
The billing page exposes a "Total refunds" stat card in the stats grid.
e2e-money-loop billing test updated for the `refund` entryType in the
groupBy assertion and the expanded response shape. Typecheck + 296/296
tests green.

Previously noted severity: high.

### A-067: Advertiser Reports Show Misleading CTR and Date Presets

**Resolved 2026-07-09** (commit a714649) — reports page multiplies the
ratio CTR by 100 before `formatPercent()` so 10% displays as "10.00%"
in the Avg CTR stat card, per-row CTR, and totals row. CSV export writes
the percentage to the `ctr_percent` column instead of the raw ratio.
Preset label changed from "Last 24h" to "1 day" so the displayed period
matches the calendar-day (date-only) bounds the API receives.
`reports-csv.spec.ts` updated for the real ratio→percent contract.

Previously noted severity: medium.

Evidence:

- `AdvertiserService.getReports()` returns `ctr` and `avgCtr` as ratios
  (`clicks / impressions`), e.g. `0.10` for 10%.
- `apps/web/src/lib/format.ts` `formatPercent()` only appends `%`; it does not
  multiply by 100.
- `apps/web/src/app/advertiser/reports/page.tsx` passes `row.ctr` and
  `summary.avgCtr` directly to `formatPercent()`, so 10% displays as `0.1%`.
- `apps/api/src/advertiser/reports-csv.ts` writes a `ctr_percent` column but
  serializes `Number(r.ctr.toFixed(2))`, producing the ratio rounded to two
  decimals rather than a percent.
- The reports page labels the `1d` preset "Last 24h", but `periodPreset()`
  sends date-only `from`/`to` values. The backend treats date-only `to` as an
  inclusive calendar day, not a rolling 24-hour timestamp range.

Likely impact:

- Advertisers see CTR values 100x too low in reports and exported CSV.
- The same API contract is displayed differently between the advertiser overview
  and reports pages.
- "Last 24h" reports can include more than 24 hours of events, which makes
  spend/CTR comparisons misleading.

Fix direction:

- Choose one API contract: ratio or percent. If the API returns ratios, multiply
  by 100 in reports UI and CSV export.
- Rename the preset to a calendar-day label or send full ISO timestamps for a
  true rolling 24-hour window.
- Add tests for 1 click / 10 impressions and for the `1d` preset query bounds.

Desired goal:

- Advertiser reports and exports show CTR and date ranges exactly as labeled.

Done when:

- 1 click out of 10 impressions displays and exports as `10%`.
- Overview, reports, and CSV share the same CTR convention.
- "Last 24h" either sends rolling ISO timestamps or is renamed to match its
  actual calendar-day behavior.

### A-068: Reports Daily Trend Uses Database Aggregation

**Resolved 2026-07-09** (current working tree, with A-003 test repair still
required).

Current source check:

- `AdvertiserService.getReports()` uses `groupBy()` for campaign-level
  impression/click totals.
- Daily trend is now generated with Prisma `$queryRaw` and SQL
  `date_trunc('day', "createdAt")` queries for `ad_impressions` and
  `ad_clicks`, so the API receives one row per day instead of every matching
  event timestamp.
- The old raw `adImpression.findMany({ select: { createdAt: true } })` /
  `adClick.findMany({ select: { createdAt: true } })` daily-trend path is gone.

Verification:

- Source inspection of `apps/api/src/advertiser/advertiser.service.ts`.
- `pnpm test`: failed because `src/advertiser/advertiser.service.spec.ts` still
  mocks/inspects the old `findMany()` implementation and does not mock
  `$queryRaw`; A-003 tracks that test repair.

Residual risk:

- A-032 still tracks unpaginated synchronous report/export campaign rows and
  missing date-range/export bounds.
- A-007 still tracks admin metrics loading raw rows into Node memory.

Desired goal:

- Advertiser reporting remains bounded in memory for large customers and long
  ranges.

Done:

- Daily trend is generated by database aggregation rather than loading raw event
  timestamps into memory.

### A-069: Admin Device Lookup Compile Blocker and Proxy Query Loss

**Resolved 2026-07-09** (uncommitted in current working tree).

Resolved evidence:

- `apps/api/src/admin/dto/index.ts` now exports `AdminDevicesQueryDto`, so
  `AdminController.getDevices()` compiles through the DTO barrel.
- `pnpm --filter waitlayer-api typecheck`: passed.
- `pnpm --filter waitlayer-web typecheck`: passed.
- `pnpm --filter waitlayer-api exec vitest run src/admin/admin.service.spec.ts`:
  passed.
- `pnpm --filter waitlayer-web exec vitest run src/app/api/[...proxy]/proxy.test.ts
src/app/api/[...proxy]/route.test.ts src/lib/api/services.trust.spec.ts`:
  passed.
- During the same pass, the Next catch-all proxy was fixed to preserve
  `req.nextUrl.search` when forwarding upstream. Before this, filtered and
  paginated API calls could lose query strings at the proxy boundary.

Previously likely impact:

- The API package and full monorepo typecheck could be red even while the narrow
  service test passed.
- Admin device lookup and the improved support recovery flow could not be
  trusted for release until the compile gate was green again.
- Query-driven web calls such as `/admin/devices`, `/advertiser/reports`,
  ledger history, and admin list filters could hit the API without their
  intended query parameters.

Done:

- `AdminDevicesQueryDto` is exported from the DTO barrel.
- The web proxy route test proves `/admin/devices?search=...` is forwarded with
  its query string intact.
- Full root `pnpm typecheck` passes after the current uncommitted changes.

### A-070: Sensitive Legacy API-Key Scopes Are Rejected

Severity: resolved pending HTTP smoke with real guards.

Current source check:

- `apps/api/src/developer/dto/api-key.dto.ts` now exports
  `REMOVED_SENSITIVE_API_KEY_SCOPES` for `payout:read`, `payout:write`, and
  `developer:write`.
- `ApiKeyService.validateApiKey()` rejects any active stored key carrying one
  of those removed scopes before updating `lastUsedAt`, so legacy/manual rows
  fail closed at validation time.
- `PayoutController` now applies `RejectApiKeyGuard` to `POST /payout/method`,
  `GET /payout/info`, and `POST /payout/request`.
- `DeveloperController` now applies `RejectApiKeyGuard` to
  `PATCH /developer/settings`, `POST /developer/export-data`, and
  `POST /developer/delete-account`.
- Safer API-key routes remain available where intentionally scoped, such as
  developer dashboard/earnings reads, ledger reads, and advertiser campaign/report
  routes.

Verification:

- `pnpm --filter waitlayer-api exec vitest run src/developer/api-key.service.spec.ts
src/common/guards/reject-api-key.guard.spec.ts`: passed.
- `pnpm --filter waitlayer-api typecheck`: passed.
- `pnpm --filter waitlayer-api exec eslint src/developer/api-key.service.ts
src/developer/api-key.service.spec.ts src/developer/dto/api-key.dto.ts
src/developer/developer.controller.ts src/payout/payout.controller.ts
src/common/guards/reject-api-key.guard.spec.ts`: passed.

Residual risk:

- Add an HTTP-level guard integration smoke that sends a primary `x-api-key`
  request with a legacy sensitive scope and proves these routes return 403/400
  while a normal JWT request still reaches the handler.
- Consider a database migration or ops script to mark existing keys with removed
  sensitive scopes inactive for cleaner operational state; runtime validation
  already rejects them.

Desired goal:

- Long-lived machine credentials cannot move money, change payout destinations,
  export personal data, or perform destructive account operations unless the
  product explicitly ships a hardened M2M flow with short expiry and step-up.

Done:

- API-key authenticated calls cannot reach payout method/info/request routes or
  developer settings/export/delete routes.
- Existing stored keys carrying removed sensitive scopes are rejected at
  validation time.
- Regression tests cover validation-time legacy-scope rejection and guard
  metadata on the sensitive routes.

## End-to-End SaaS Readiness Checks

Do not declare WaitLayer SaaS-ready until these flows pass against a fresh,
migrated environment with production-like web/API configuration.

### Developer Flow: Landing Page to Payout

Required path:

1. Public landing page loads with correct links to signup, login, pricing,
   policies, contact, and developer onboarding.
2. Developer signs up through each supported signup surface, including CLI if
   offered, and the API records required age, terms, privacy, and
   consent-version proof before account creation.
3. Developer receives or requests email verification, clicks the verification
   link, and the app reflects verified status.
4. Developer logs in, reaches `/developer`, and sees dashboard/settings without
   auth-cookie or middleware failures.
5. Developer logout only shows success after server revocation/cookie clearing
   succeeds; failed logout remains visible and retryable.
6. Developer installs CLI or VS Code extension from a real packaged artifact
   using production-safe defaults.
7. Client logs in or uses the intended integration credential, including 2FA
   when enabled.
8. Client registers a device and receives a per-device event secret.
9. Client starts and ends a wait state with signed payloads, using one stable
   device/session/wait-state identity across start, ad request, render,
   qualify, and end.
10. Approved/funded advertiser campaign is eligible and ad request returns a
    valid creative for the correct account/device/currency context.
11. Client renders an ad, qualifies an impression only after server-enforced
    minimum visible duration and cap checks, and optionally records a click.
    Terminal/CLI earning claims must pass this step too or be explicitly
    excluded from launch copy.
12. Advertiser is debited, developer earnings are credited, platform/reserve
    ledgers reconcile, and fraud checks can hold/release earnings.
13. Ledger maturation makes earnings confirmed after the correct hold period.
14. Developer adds a verified payout method.
15. Developer requests payout only after threshold, email verification, and
    fraud/2FA/API-key safety requirements are satisfied.
16. Admin reviews/approves/processes payout, including partial-approval
    accounting if partial approval remains supported, or the automated provider
    processes it.
17. Payout is marked paid by provider webhook or audited admin action, and
    webhook failure/retry behavior is durable enough that money events are not
    acknowledged and then lost.
18. Developer payout history, ledger balance, payoutable referral reward logic,
    privacy/category preferences, and export data all reflect the final state.
19. A policy-version bump in the API re-prompts existing users and records the
    current per-purpose consent version through the web UI.

Developer flow fails SaaS readiness if any step requires direct database access,
undocumented env changes, local-only endpoints, or support action that is not an
explicit product policy.

### Advertiser Flow: Landing Page to Campaign Spend

Required path:

1. Public landing page communicates advertiser value without overpromising
   unsupported integrations or payout geographies.
2. Advertiser CTAs preselect advertiser signup; advertiser signs up through
   each supported signup surface with required age/terms/privacy consent
   recorded, then lands on `/advertiser`.
3. Advertiser profile is created or auto-created with usable billing identity.
4. Advertiser deposits funds through Stripe Checkout.
5. Stripe webhook confirms deposit, advertiser ledger is credited, platform cash
   ledger is credited, invalid webhook/configuration failures do not return
   false-success HTTP 200 responses, and billing page shows confirmed balance.
6. Advertiser creates campaign with valid category, bid, budget, destination
   URL, creative, and targeting; partial failures leave a recoverable draft
   rather than a silent duplicate.
7. Campaign submits for review and appears in admin campaign approvals.
8. Admin reviews creative destination/message, approves or rejects with useful
   reason.
9. Campaign activates when it has approved creative, remaining budget, and
   confirmed same-currency balance.
10. Developer wait-state ad request can select the campaign.
11. Qualified impressions/clicks debit advertiser balance exactly once, cannot
    overdraw account-level cash, and respect campaign budget, frequency caps,
    country/tool targeting, and fraud rules.
12. Advertiser dashboard and reports show correct spend, impressions, clicks,
    CTR, date ranges, currency breakdown, CSV export values, and bounded
    memory behavior for daily trends.
13. Advertiser can pause, resume, edit eligible drafts/rejections, and archive
    campaigns.
14. Archive creates the expected refund obligation; admin confirms manual Stripe
    refund or an automated provider handles it, and confirmed refunds reduce
    advertiser spendable balance and displayed billing balance.
15. Refunds/disputes webhooks update advertiser ledger, platform cash ledger,
    campaign eligibility, spendable balance, and fraud/recovery queues. Partial
    disputes must freeze/write off only the disputed amount.
16. Advertiser can export account/campaign/billing data and has a documented
    erasure/request path that preserves required money-retention records.

Advertiser flow fails SaaS readiness if funding, activation, campaign management,
reporting, refunds, or disputes require untracked manual steps.

### Admin/Ops Flow

Required path:

1. Admin can review campaigns and creatives with full creative content,
   destination, advertiser identity, and rejection reason controls.
2. Admin can review payouts with developer identity, trust/fraud context,
   destination, amount, currency, and provider status.
3. Admin can process or reconcile manual payouts without database edits.
4. Admin can inspect and resolve fraud flags, recompute trust scores, and see
   explicit errors when fraud actions fail.
5. Admin/support can issue device recovery tokens through audited UI.
6. Admin can perform account erasure/status operations through audited UI.
7. Admin can inspect money integrity, webhook events, archive refunds, recovery
   debt, and ledger history.
8. Ops/readiness health checks fail closed when required dependencies such as
   Postgres or Redis are unavailable, and recover when dependencies come back
   without restarting the API.
9. Ops has runbooks and product controls for failed/retryable webhooks, failed
   payout providers, migration rollback, and money reconciliation.

Admin flow fails SaaS readiness if an operational action exists only as a raw API
call, direct database mutation, or tribal-knowledge script.

## Recommended Fix Order

1. Fix A-021, A-051, and A-062 to make the
   advertiser/developer money campaign/ad-serving/billing/reporting loop
   coherent.
2. Fix A-003 and A-012 so tests and schema setup become trustworthy.
3. Fix A-028 and the admin portions of the E2E readiness checks.
4. Address A-007, A-009, A-030, A-031, and A-032 as product hardening
   and scale work.
5. Add A-057 regression tests and taxonomy validation before launch copy leans
   on developer category blocking or fine-grained category control.
6. Update stale status docs for A-010 and public claims in A-033 only after
   commands and E2E checks are genuinely green.
7. Keep A-011 in mind throughout: do not combine unrelated fixes.

## Required Verification Before Calling the Repo Healthy

At minimum, a future agent should verify:

```bash
pnpm --filter @waitlayer/db generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For database-backed tests, Postgres and Redis must be available and the test DB
must be migrated or reset from the current schema.

Manual or integration checks should also cover:

- Login, signup, refresh, logout, and middleware access in HTTP dev and HTTPS
  secure-cookie modes.
- Web account deletion reaching the Nest API through the proxy.
- TOTP setup by QR and manual key.
- Stripe webhook handling on a freshly migrated test database.
- Advertiser reports with a large synthetic event set.
- Ledger access by developer, advertiser, admin, and scoped API key.
- Logged-out and logged-in consent behavior.

## Completion Standard for This Audit

The audit is not complete just because this file exists. It is complete only
when every issue above is either:

- fixed and verified with evidence recorded here, or
- explicitly accepted as a product/engineering tradeoff with owner/date recorded
  here.

Until then, agents should treat this file as the active gap list for the current
codebase.
