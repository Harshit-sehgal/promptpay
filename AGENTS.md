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

Snapshot date: 2026-07-09.

Observed verification state from the codebase audit:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: failed with API test failures.
- `pnpm build`: failed at the root/Turbo level during the Next.js build.
- `pnpm --filter waitlayer-web build`: passed when run directly after the root
  build failure.

Important caveat: this is a snapshot. Re-run the commands before starting and
before declaring the repo healthy.

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

Severity: critical.

Evidence:

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

Severity: critical.

Evidence:

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

### A-003: Test Suite Fails and Test DB Schema Can Drift

Severity: high.

Evidence:

- `pnpm test` fails in API tests.
- `apps/api/src/developer/developer.service.spec.ts` constructs
  `DeveloperService` without the newer email dependency.
- `apps/api/src/developer/developer.service.ts` now calls
  `email.sendAccountDeleted()` during account deletion.
- Stripe webhook integration tests fail with missing database columns including
  `data_retention_config.createdAt` and `webhook_events.updatedAt`.
- Migrations exist for those columns in `packages/db/prisma/migrations`, which
  means the test database setup is not reliably applying the current schema.

Likely impact:

- CI cannot be trusted as a release gate.
- Integration tests can pass or fail based on local database drift.
- A production database without applied migrations would hit runtime 500s in
  code paths that expect the new columns.

Fix direction:

- Add the missing email mock to `DeveloperService` tests.
- Make integration test setup create or reset a database from the current Prisma
  schema or apply all migrations before tests run.
- Fail fast when migrations and generated Prisma client/schema are out of sync.
- Keep migrations append-only; do not hand-edit a live migration unless the team
  confirms it has never been applied anywhere.

Desired goal:

- The test suite is reproducible from a clean database and proves the current
  schema, service constructors, and webhook paths are aligned.

Done when:

- `pnpm test` passes from a clean local setup with Postgres and Redis available.
- Stripe webhook integration tests no longer emit missing-column errors.
- Developer account deletion tests cover the non-blocking email behavior.
- CI documents or performs the same database setup as local tests.

### A-004: Web Account Deletion Is Blocked by Proxy Allowlist

Severity: high.

Evidence:

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

Severity: high.

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

Severity: medium-high.

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

### A-007: Advertiser Reports Load Raw Event Rows Into Memory

Severity: medium.

Evidence:

- `apps/api/src/advertiser/advertiser.service.ts` fetches raw billable
  impressions and valid clicks with `findMany()` and aggregates them in
  JavaScript for reports.

Likely impact:

- Large advertisers or long date ranges can make report requests slow or memory
  heavy.
- The API can become less predictable under real traffic.

Fix direction:

- Move campaign and daily aggregation into the database where practical.
- Consider a daily metrics table/materialized view for impressions, clicks,
  spend, CTR, and unique users.
- Enforce date-range limits or pagination if raw drill-down remains necessary.

Desired goal:

- Report endpoints have bounded memory usage and predictable latency for
  production-sized event volume.

Done when:

- Report generation no longer depends on loading all matching impressions and
  clicks into application memory.
- Tests or benchmarks cover a large synthetic event set.
- API behavior for empty campaign sets and invalid date ranges remains correct.

### A-008: Ledger Developer Endpoints Have a Loose Role Boundary

Severity: medium.

Evidence:

- `apps/api/src/ledger/ledger.controller.ts` applies `JwtAuthGuard` and
  `AllowApiKey()` at the controller level.
- Developer-facing ledger endpoints use the current user id and
  `ledger:read` scope, but they do not require the `developer` role.
- Admin ledger endpoints add `RolesGuard` and admin roles separately.

Likely impact:

- This is not obvious cross-tenant leakage because queries are scoped to the
  current user, but role boundaries are inconsistent with `DeveloperController`.

Fix direction:

- Decide whether advertiser/admin users should ever see their own earnings
  ledger through these endpoints.
- If not, add `RolesGuard` and `@Roles('developer')` to developer ledger routes.
- Keep admin ledger routes explicitly admin-only.

Desired goal:

- Ledger route access matches the product's role model rather than relying only
  on user-id scoping.

Done when:

- Non-developer JWTs receive 403 for developer ledger endpoints if that is the
  intended policy.
- API keys still require the correct `ledger:read` scope.
- Tests cover developer, advertiser, admin, and API-key access cases.

### A-009: Logged-Out Cookie Consent Is Local-Only

Severity: medium.

Evidence:

- `apps/api/src/compliance/compliance.controller.ts` protects `/consent` with
  `JwtAuthGuard`.
- The web cookie consent component posts to `/consent`, but unauthenticated
  visitors cannot create server-side consent records.

Likely impact:

- Anonymous consent is stored only in the browser.
- This may be acceptable, but it is a product/legal decision, not something the
  code should leave ambiguous.

Fix direction:

- Ask product/legal whether anonymous consent must be server-auditable.
- If yes, add an anonymous consent endpoint using a signed pseudonymous visitor
  id and careful metadata minimization.
- If no, document that logged-out marketing consent is browser-local and only
  authenticated user consent is server-recorded.

Desired goal:

- Consent behavior is intentional and matches the compliance target.

Done when:

- The expected logged-out behavior is documented and tested.
- If server-side anonymous consent is required, the API and web flow support it
  without weakening authenticated consent records.

### A-010: Docs Claim Health That the Code Does Not Currently Have

Severity: medium.

Evidence:

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

Severity: medium.

Evidence:

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

Severity: medium.

Evidence:

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

Severity: high.

Evidence:

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

### A-014: Developer API Keys Do Not Match the Extension/CLI Auth Path

Severity: high.

Evidence:

- The developer settings page creates API keys with scopes
  `['extension:write', 'ledger:read']` and says they are for extension and CLI
  integrations.
- `ExtensionController` is JWT-only; it is not decorated with `@AllowApiKey()`.
- The CLI and VS Code extension use email/password login and bearer access
  tokens, not API keys.

Likely impact:

- Users can create an "extension" key that cannot actually call extension
  event endpoints.
- Future agents may build onboarding around API keys and ship a broken
  developer integration path.

Fix direction:

- Decide the intended integration auth model:
  - If clients should use user sessions, remove "extension/CLI" API-key copy
    and scopes from the UI.
  - If machine clients should use API keys, add `@AllowApiKey()` and scoped
    handling to the extension endpoints, then update CLI/extension clients to
    support `x-api-key`.
- Keep per-device event-secret signing either way; API key auth must not replace
  event payload signatures.

Desired goal:

- Developer onboarding has exactly one documented, working auth path for
  clients, or explicitly supports both user-session and API-key modes.

Done when:

- A freshly created integration credential can actually register a device and
  submit signed wait-state events.
- The settings UI, CLI help, VS Code config, API scopes, and controller guards
  describe the same auth model.
- Tests cover API-key and/or user-token client registration as intended.

### A-015: Email Verification Has No User-Facing Request/Resend Path

Severity: high.

Evidence:

- The API exposes `POST /auth/verify-email/request`.
- Payout requests are blocked unless `user.emailVerified` is true.
- The web service/proxy/UI expose only `/auth/verify-email/confirm`, not a
  logged-in "send verification email" or "resend verification email" action.

Likely impact:

- Email/password developers can sign up, earn, and then be blocked from payout
  without a clear self-service way to verify their email.
- Support burden rises because a core money-flow precondition is hidden.

Fix direction:

- Add a web service method and proxy allowlist entry for
  `/auth/verify-email/request`.
- Show email verification status and a resend action in developer settings,
  payout blocking UI, and onboarding.
- After successful verification, refresh `/auth/me` so the client state matches
  the server.

Desired goal:

- Every user blocked by email verification can complete verification without
  contacting support.

Done when:

- A new email/password developer can request verification, click the email link,
  return to the app, and request a payout.
- Payout UI explains the block and links directly to the verification action.
- Tests cover request, confirm, expired token, and already-verified states.

### A-016: Web Runtime Environment Is Not Validated Like the API

Severity: high.

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

Severity: medium-high.

Evidence:

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

Severity: medium-high.

Evidence:

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

Severity: high.

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

### A-020: Advertiser Campaign Pause/Resume UI Is Wired to the Wrong States

Severity: high.

Evidence:

- Backend pause transition is `active -> paused`.
- `apps/web/src/app/advertiser/campaigns/page.tsx` shows the Pause button when
  `campaign.status === 'approved'`.
- Active campaigns do not get a Pause button in that page.

Likely impact:

- Live campaigns cannot be paused from the advertiser UI.
- Clicking Pause on an approved campaign calls an API path that should reject.

Fix direction:

- Show Pause only for `active`.
- Show Activate/Resume only for states the backend actually accepts.
- Add tests for campaign action visibility by status.

Desired goal:

- The advertiser campaign page presents only valid state transitions.

Done when:

- Active campaigns can be paused from the UI.
- Paused campaigns can be resumed from the UI.
- Approved but inactive campaigns show an activation/blocker state, not Pause.

### A-021: Advertiser Cannot Recover or Manage Draft/Rejected/Archived Campaigns

Severity: medium-high.

Evidence:

- Campaign update and archive endpoints exist on the API.
- The advertiser campaigns page has an Edit button for drafts with an empty
  `onClick`.
- There is no visible archive action.
- Rejection reasons are not clearly surfaced to advertisers, and there is no
  complete edit/resubmit loop for rejected campaigns.

Likely impact:

- Advertisers can create and submit a campaign, but cannot manage its full
  lifecycle without support or direct API calls.
- Refund obligations from archive flow exist, but the advertiser UI does not
  expose the user-facing archive/refund request path.

Fix direction:

- Add campaign detail/edit page for draft and rejected campaigns.
- Add resubmit after edits.
- Add archive action with clear refund/remaining-budget explanation.
- Show campaign and creative rejection reasons.

Desired goal:

- Advertisers can self-serve campaign correction, resubmission, pause/resume,
  and closure.

Done when:

- E2E test covers draft edit, submit, reject with reason, advertiser edit,
  resubmit, approve, active, pause, resume, archive.
- Archive creates the expected refund obligation and the UI reflects it.

### A-022: Campaign CTA Text Is Collected but Not Used

Severity: medium.

Evidence:

- The new campaign page collects `ctaText`.
- `CreateCreativeDto`, `CreativeResponse`, ad serving responses, and the
  extension ad type do not include CTA text.
- The submitted creative payload sends title, sponsored message, destination
  URL, and display domain only.

Likely impact:

- Advertisers configure a CTA that is never served.
- The creative preview can disagree with the actual ad.

Fix direction:

- Either remove the CTA text field from the UI or add it to the creative model,
  validation, approval UI, ad-serving payload, extension rendering, and reports.

Desired goal:

- Every advertiser creative field in the UI maps to stored and served ad data.

Done when:

- Creating a campaign with CTA text results in that CTA appearing in the served
  ad, or the UI no longer asks for CTA text.
- Contract tests cover the chosen behavior.

### A-023: Deposit Success UI Claims Credit Before Webhook Confirmation

Severity: medium.

Evidence:

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

Severity: medium.

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

### A-025: Admin Users Page Expects Fields the API Does Not Return

Severity: medium.

Evidence:

- `AdminService.getUsers()` returns `id`, `email`, `name`, `role`, `status`,
  `trustLevel`, `country`, and `createdAt`.
- `apps/web/src/app/admin/users/page.tsx` expects `displayName`, `trustScore`,
  and `flagsOpen`.

Likely impact:

- Admin user table can show `undefined/100` trust values, missing names, and no
  real open-flag count.

Fix direction:

- Either change the API to return the fields the UI needs, or update the UI to
  render the actual response shape.
- Include open fraud flag counts if ops needs triage from this page.

Desired goal:

- The admin user table is a reliable operational view of account status and
  risk.

Done when:

- User rows show correct name/email, role, status, trust/trust score, and open
  fraud count.
- A response-shape test covers the admin users endpoint and page mapping.

### A-026: Admin Payout Queue Hides Important Backend Data and Recovery Paths

Severity: medium.

Evidence:

- `AdminService.getPendingPayouts()` includes `user.email`, `user.name`,
  `trustLevel`, payout account, status, and latest transaction.
- The admin payout page expects `userEmail` and falls back to `userId`.
- The backend supports partial approval through `approvedAmountMinor`, but the
  UI only exposes full approve.
- Mark-paid requires an existing provider transaction id; the UI has no manual
  reconciliation input even though manual payout providers are part of the
  product flow.

Likely impact:

- Admins have less context for payout risk review.
- Manual/provider-failure payout reconciliation can get stuck in the UI.
- Partial approval support exists but is not usable by operators.

Fix direction:

- Map nested user data correctly in the payout page.
- Add partial approval input with bounds validation.
- Add a controlled manual reconciliation path for provider transaction id,
  amount, currency, and paid timestamp when appropriate.

Desired goal:

- Admins can review, approve, partially approve, process, reject, and reconcile
  payouts entirely from the admin UI.

Done when:

- Payout rows show developer email/name/trust level.
- Partial approval is usable and cross-checked.
- Manual payout reconciliation can mark paid without requiring a pre-created
  transaction that the UI cannot supply.

### A-027: Device Recovery Token Flow Exists in API but Not in Admin UI/Proxy

Severity: medium-high.

Evidence:

- `AdminController` exposes `POST /admin/devices/:id/recovery-token`.
- The web proxy allowlist includes many `/admin/*` prefixes but not
  `/admin/devices`.
- There is no admin service method or page for issuing device recovery tokens.
- CLI and VS Code clients explicitly prompt for/use support-issued recovery
  tokens.

Likely impact:

- Users who lose a per-device event secret are told to get a support token, but
  support has no web UI route to issue it.

Fix direction:

- Add proxy allowlist and admin API client method for device recovery.
- Add an admin/support UI flow from user/device details.
- Log/restrict issuance with reason, expiry, reviewer role, and one-time use.

Desired goal:

- Support can recover legitimate devices without database access or ad hoc
  scripts.

Done when:

- Admin/support can issue a token from the UI.
- CLI/extension recovery succeeds with that token.
- Audit log records issuance and consumption.

### A-028: Admin Erasure Endpoint Is Not Exposed in the Users UI

Severity: medium.

Evidence:

- `AdminController` exposes `POST /admin/users/:id/erase`.
- The admin users page is read-only and does not expose erasure, restriction,
  ban, unban, or account status actions.

Likely impact:

- GDPR/ToS operations require direct API calls or database/manual action.

Fix direction:

- Add guarded admin user actions with confirmation dialogs.
- Require explicit confirmation for irreversible erasure.
- Show audit trail and current status on the user detail page.

Desired goal:

- Support/admin can perform account lifecycle operations from audited UI flows.

Done when:

- Admin can erase an eligible user through the UI.
- Super-admin erasure remains blocked.
- The action revokes sessions/API keys and writes audit events.

### A-029: Feedback Form Is Local-Only but Claims the Team Reads It

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

### A-031: Currency Rules Are Too Generic for a Global SaaS

Severity: medium.

Evidence:

- Payout minimum threshold is a single `PAYOUT.MINIMUM_THRESHOLD_MINOR` applied
  across currencies.
- Deposit minimum is `100` minor units across all supported currencies.
- Payout UI treats all currencies as two-decimal currencies.

Likely impact:

- Minimums can be nonsensical for some currencies.
- Future zero-decimal or high-inflation currencies will display or validate
  incorrectly.

Fix direction:

- Add a currency policy table for supported currencies: minor-unit exponent,
  deposit minimum, payout minimum, provider availability, and settlement rules.
- Use that policy in API DTO validation, UI formatting, payout requests, and
  advertiser deposits.

Desired goal:

- Multi-currency behavior is explicit and correct per supported currency.

Done when:

- Adding/removing a currency happens through one policy table.
- Tests cover USD plus at least one non-USD supported currency.

### A-032: Advertiser Reporting Has No Export/API Pagination Path

Severity: medium.

Evidence:

- Reports are rendered in the UI from a single unpaginated API response.
- A separate issue already notes raw event aggregation in memory.
- There is no CSV export or paginated report API for advertisers.

Likely impact:

- Advertisers cannot reconcile spend outside the dashboard.
- Large accounts will need data export before the API is optimized.

Fix direction:

- Add paginated campaign report endpoints and CSV export.
- Include date range, campaign id, currency, spend, impressions, clicks, CTR,
  and refund/invalid-traffic adjustments.

Desired goal:

- Advertisers can audit and export campaign performance and spend.

Done when:

- Reports can be exported for a bounded date range.
- API and UI handle large accounts without loading all rows at once.

### A-033: Landing-to-Product Claims Need Runtime Verification

Severity: medium.

Evidence:

- The landing page advertises installable VS Code/terminal integrations,
  PayPal-first payouts, global payouts, transparent earnings, trust scoring,
  advertiser reach, and privacy-first integrations.
- `apps/web/src/app/comparison/page.tsx` marks Cursor, Windsurf, Cline,
  Claude Code, and Terminal as `Live`, with checks for wait detection, ad
  display, clicks, earnings tracking, and frequency controls.
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

### A-034: Signup Age and Terms Consent Are UI-Only and Bypassable

Severity: high.

Evidence:

- `apps/api/src/auth/dto/signup.dto.ts` has no `ageConfirmed`,
  `termsAccepted`, policy version, or consent-version field.
- `apps/web/src/app/auth/signup/page.tsx` blocks only the email/password form
  on `ageConfirmed`; Google signup is triggered by the Google button/callback
  and does not check or send that value.
- `apps/cli/src/commands/auth.ts` can create developer or advertiser accounts
  from the terminal without any age/terms confirmation.
- `AuthService.googleOAuth()` creates new users from Google tokens without any
  policy-consent input.

Likely impact:

- Minors or users who never accepted the Terms/Privacy policy can create
  accounts through Google signup, CLI signup, or direct API calls.
- Legal/compliance state is not auditable per user or policy version at account
  creation.

Fix direction:

- Make age and required policy acceptance part of the API contract, not only a
  React checkbox.
- Require the same fields for email/password signup, Google OAuth first-time
  account creation, and CLI signup.
- Persist consent records with the exact policy versions accepted at signup.
- Disable or clearly block signup surfaces that cannot collect the required
  consent.

Desired goal:

- Every self-service account creation path proves the user accepted the current
  required terms/privacy versions and age requirement before the user row is
  created.

Done when:

- API DTOs and services reject missing required signup consent for all signup
  paths.
- Web Google signup cannot create an account unless the age/terms control has
  been accepted.
- CLI signup prompts for the same acceptance or refuses signup.
- Tests cover email/password, Google, CLI/direct API, and missing-consent
  rejection paths.

### A-035: Payout 2FA Policy and Client Support Are Inconsistent

Severity: high.

Evidence:

- `apps/web/src/app/security/page.tsx` says 2FA is mandatory before requesting
  financial payouts and fully integrated into the VS Code extension and CLI.
- `PayoutService.requestPayout()` enforces 2FA only when
  `PAYOUT_REQUIRE_2FA === 'true'`.
- `.env.example`, `.env`, and `apps/api/.env` show
  `PAYOUT_REQUIRE_2FA=false`.
- `apps/cli/src/commands/auth.ts` login only prompts for email/password; it
  never asks for or resubmits `twoFactorToken`.
- VS Code login has 2FA handling, so client support is uneven.

Likely impact:

- The security page overstates the current payout requirement.
- If operators enable `PAYOUT_REQUIRE_2FA=true`, CLI users with 2FA-protected
  accounts cannot log in through the CLI.
- If operators leave it false, payouts can be requested without the advertised
  2FA requirement.

Fix direction:

- Decide the launch policy: mandatory 2FA for payouts, risk-tiered 2FA, or
  optional 2FA.
- Align `PAYOUT_REQUIRE_2FA`, public copy, payout UI, and client login flows.
- Add CLI 2FA challenge handling matching the VS Code extension.
- Show payout blockers before the user submits a payout request.

Desired goal:

- The product, API, and clients all enforce the same 2FA policy for login and
  payout money movement.

Done when:

- A 2FA-enabled developer can log in with both CLI and VS Code.
- A payout request without required 2FA is blocked with a clear UI/client
  message.
- Security and payout-policy pages describe the exact behavior that is
  enforced in production.

### A-036: CCPA Do-Not-Sell Opt-Out Is Only Stored in Browser Local Storage

Severity: high.

Evidence:

- `apps/web/src/app/privacy/page.tsx` stores the CCPA opt-out flag only in
  `window.localStorage` under `wl_ccpa_opt_out`.
- There is no API route or service method that records a CCPA opt-out against a
  user account.
- The privacy page copy says the switch records the preference "on this
  device", but a SaaS handling advertiser targeting needs server-side
  enforcement if that preference is meaningful.

Likely impact:

- The opt-out does not follow the user across devices or browsers.
- Backend ad-serving, reporting, and advertiser use of data cannot actually
  honor the preference.
- Operators have no auditable record of CCPA requests.

Fix direction:

- Add a server-side privacy preference/consent record for authenticated users.
- For logged-out users, either keep the device-only wording very explicit or
  provide a request workflow tied to email/account identity.
- Ensure ad-serving/reporting checks the preference if it affects sharing or
  targeting.

Desired goal:

- Privacy choices that affect platform behavior are durable, auditable, and
  enforced server-side.

Done when:

- CCPA opt-out can be recorded and retrieved from the backend.
- The backend has a documented behavior for opt-out during ad selection,
  reporting, and advertiser data use.
- The UI distinguishes local-only preferences from account-level legal
  preferences.

### A-037: Long-Lived API Keys Can Be Minted for Money and Data Scopes

Severity: high.

Evidence:

- `ALLOWED_API_KEY_SCOPES` includes `developer:write`, `payout:write`, and
  `payout:read`.
- `DeveloperController` is class-decorated with `@AllowApiKey()` and exposes
  `export-data` and `delete-account` with `developer:write`.
- `PayoutController` is class-decorated with `@AllowApiKey()` and exposes
  `payout/method` and `payout/request` with `payout:write`.
- The API-key creation endpoint lets an authenticated developer request any
  allowed scopes; the web UI currently mints narrower keys, but the API surface
  itself is broader.

Likely impact:

- A leaked long-lived API key can add payout methods, request payouts, or export
  personal data if it was minted with broad scopes.
- Sensitive money-movement actions are not clearly separated from machine
  integration credentials.

Fix direction:

- Remove payout and destructive/privacy scopes from self-service API keys unless
  there is a deliberate machine-to-machine product for them.
- Require short expiry, 2FA step-up, or separate admin approval for sensitive
  API-key scopes.
- Consider making export/delete/payout endpoints JWT-only.
- Add UI disclosure and audit alerts for sensitive key issuance if retained.

Desired goal:

- API keys used by extensions/automations cannot silently become durable payout
  or account-data exfiltration credentials.

Done when:

- Self-service API keys cannot call payout/write or privacy/destructive
  endpoints unless an explicit, tested policy allows it.
- Tests prove insufficient scopes and ordinary extension keys are rejected.
- Sensitive API-key creation is visible in audit/admin surfaces.

### A-038: Ad-Request Cache Is Not Scoped by User or Device

Severity: medium.

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

Severity: medium.

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

### A-040: CLI Watch Does Not Request, Render, or Qualify Ads

Severity: high.

Evidence:

- `apps/cli/src/commands/watch.ts` only calls `reportWaitState()` and
  `endWaitState()`.
- `apps/cli/src/lib/api-client.ts` has methods for wait-state start/end but no
  CLI ad-request, rendered, qualified-impression, click, or report-ad path.
- The public product presents the terminal integration as part of earning from
  AI wait states.

Likely impact:

- Terminal users can report wait states but cannot actually generate ad
  impressions, advertiser debits, developer earnings, or payoutable balance.
- The developer E2E path from terminal install to payout is not real.

Fix direction:

- Either implement a terminal ad-rendering/qualification flow or reposition the
  CLI as telemetry/config-only until it can earn.
- If implemented, add privacy-safe terminal rendering, visible-duration rules,
  click/report handling, and signed event submission.
- Add E2E tests for CLI wait-state start → ad request → render → qualification
  → earnings ledger.

Desired goal:

- The terminal integration either earns through a complete audited ad event
  flow or is clearly not advertised as an earning surface.

Done when:

- A CLI-only developer can complete the same money loop as a VS Code developer,
  or public copy and onboarding exclude CLI earning claims.

### A-041: Referral Rewards Are Not Payoutable Developer Earnings

Severity: high.

Evidence:

- `ReferralService.processReferralRewards()` creates a `referralReward` row and
  a `platformLedger` credit with bucket `referral_bonus`.
- It does not create an `earningsLedger` credit for the referrer.
- `PayoutService.getPayoutInfo()`, `getAvailableForPayout()`, and
  `requestPayout()` compute payoutable balances only from `earningsLedger`
  credits/debits and allocations.
- The referral UI says developers earn a `$5` reward when the referred user
  gets a qualifying first payout.

Likely impact:

- Referral rewards can appear in the referral dashboard but never become
  withdrawable through the payout system.
- Money accounting is ambiguous: the platform ledger is credited rather than
  reserving or debiting a liability payable to the referrer.

Fix direction:

- Decide whether referral rewards are payoutable cash, platform credits, or
  non-cash promotional rewards.
- If payoutable, write a matching `earningsLedger` credit for the referrer with
  clear source/idempotency and hold/confirmation behavior.
- If non-cash, change UI/copy and accounting to avoid implying withdrawable
  earnings.

Desired goal:

- Referral rewards have a single accounting treatment that matches what the UI
  promises and what payouts can actually withdraw.

Done when:

- A referred user's first qualifying payout creates an auditable reward that is
  either included in payout availability or clearly marked non-payoutable.
- Tests cover referral reward creation, idempotency, dashboard totals, and
  payout availability.

### A-042: Health Endpoint Reports HTTP 200 Even When Dependencies Fail

Severity: medium.

Evidence:

- `HealthController.check()` always returns an object with `status: 'ok'`.
- Database failures are represented inside `database: { status: 'error' }` but
  the response status remains HTTP 200.
- Redis failures are represented in the JSON body while the HTTP status remains
  200.
- Docker and docker-compose healthchecks call `/api/v1/health` with `wget
  --spider`, which only checks the HTTP status.

Likely impact:

- Containers or load balancers can consider the API healthy while the database
  or Redis-backed abuse controls are down.
- Public status can say "ok" while critical dependencies are degraded.

Fix direction:

- Split liveness and readiness: liveness can return 200 for process health,
  readiness should fail non-200 when required dependencies are unavailable.
- Point Docker/Kubernetes readiness checks at the dependency-aware endpoint.
- Make the status page consume and display readiness semantics accurately.

Desired goal:

- Deployment health checks reflect whether the API can safely serve product
  traffic.

Done when:

- DB-down and Redis-down scenarios are covered by tests or local verification.
- Runtime healthcheck/readiness commands fail when required dependencies fail.
- The public status UI no longer treats `status: ok` as authoritative if
  dependencies are degraded.

### A-043: Distributed Client Packaging Is Not Launch-Ready

Severity: medium.

Evidence:

- `apps/cli/package.json` has `"private": true`, so it cannot be published to
  npm as-is.
- The CLI `bin` points to `./dist/apps/cli/src/index.js`, which must be
  verified against the actual `tsc` output before packaging.
- `apps/vscode-extension/package.json` has a publisher and extension metadata
  but no repository packaging/publishing script for `.vsix` or marketplace
  release.
- A-013 separately covers the localhost default once a package is installed.

Likely impact:

- The landing/onboarding claim that users can install the terminal or VS Code
  integrations is not backed by a release artifact pipeline.
- Manual local builds can work while public install paths do not exist.

Fix direction:

- Add a real CLI release package configuration, package contents check, and
  publish workflow.
- Add VS Code `.vsix` packaging and marketplace/private-distribution workflow.
- Include smoke tests that install the packaged artifacts and run login/config
  commands against a production-like API URL.

Desired goal:

- Users can install signed/versioned client artifacts without cloning the
  monorepo.

Done when:

- CLI and VS Code artifacts are built from CI/release workflow outputs.
- Packaged artifacts have production-safe defaults and pass install smoke
  tests.

### A-044: Advertisers Lack Equivalent Self-Service Privacy Export/Deletion

Severity: medium.

Evidence:

- Data export and account deletion are implemented under
  `DeveloperController` as `/developer/export-data` and
  `/developer/delete-account`.
- `developerApi` exposes export/delete methods, and the developer settings page
  has a data export UI.
- There is no equivalent advertiser API or advertiser settings UI for export or
  self-service deletion.
- The admin erasure endpoint exists, but A-028 notes it is not exposed in the
  admin Users UI either.

Likely impact:

- Advertiser users do not have the same self-service privacy controls as
  developer users.
- GDPR/CCPA request handling for advertisers depends on support/admin manual
  paths that are not complete in the product UI.

Fix direction:

- Add account/privacy settings for advertiser users.
- Implement advertiser export that includes profile, campaigns, creatives,
  billing ledger, deposits/refunds, reports, consent, and account data.
- Implement guarded advertiser self-deletion/erasure or a clearly documented
  request workflow with admin UI support.

Desired goal:

- Every user role has a clear, tested privacy export and erasure path.

Done when:

- Developer and advertiser privacy controls exist and are role-appropriate.
- Exports include all personal/account/business data relevant to the role.
- Deletion/erasure is audited and does not break money-retention/legal-hold
  requirements.

### A-045: Admin Creative Rejection Uses A Hard-Coded Reason

Severity: medium.

Evidence:

- `apps/api/src/campaign/campaign.service.ts` stores creative rejection text in
  `adCreative.rejectionReason`.
- `CampaignController.rejectCreative()` accepts `@Body('reason')`, so the API
  can preserve a reviewer-specific reason.
- `apps/web/src/app/admin/campaigns/page.tsx` calls
  `campaignApi.rejectCreative(creativeId, 'Rejected by admin')` with no modal,
  note field, or advertiser-facing remediation detail.
- Campaign rejection has a dedicated reason modal on the same page, but creative
  rejection does not.

Likely impact:

- Advertisers cannot tell which creative element failed review, so recovery
  becomes guesswork.
- Admin audit entries and stored rejection reasons lose the context needed for
  support disputes and policy consistency.
- A-021 covers broader draft/rejected campaign recovery; this is the specific
  creative-review reason gap.

Fix direction:

- Add a creative rejection modal that requires a concise policy/remediation
  reason.
- Validate and send that reason through `campaignApi.rejectCreative()`.
- Show the stored creative rejection reason to advertisers wherever they edit or
  resubmit creatives.
- Add a regression test for rejecting a creative with a custom reason.

Desired goal:

- Every creative rejection leaves a specific, durable, advertiser-visible reason.

Done when:

- Admins cannot reject a creative from the UI without entering a reason.
- Advertisers can see the exact reason before editing/resubmitting the creative.
- The audit trail and `adCreative.rejectionReason` contain the submitted reason,
  not a generic placeholder.

### A-046: Fraud Trust Recompute UI Treats Failed Requests As Success

Severity: medium.

Evidence:

- `apps/api/src/admin/admin.controller.ts` exposes
  `POST /admin/fraud/compute-trust/:userId`, and `AdminService` forwards it to
  `FraudService.computeTrustScore()`.
- `apps/web/src/lib/api/services.ts` has typed `adminApi` helpers for fraud
  list/stats/resolve actions, but no helper for trust recompute.
- `apps/web/src/app/admin/fraud/page.tsx` calls raw
  `fetch('/api/admin/fraud/compute-trust/${userId}', { method: 'POST' })`.
- The handler never checks `response.ok`; browser `fetch()` resolves for 4xx and
  5xx responses, so the UI refreshes and clears the busy state as if the action
  succeeded.

Likely impact:

- Admins can believe a user's trust score was recomputed even when the proxy or
  API rejected the request.
- Fraud review decisions can proceed from stale trust data without a visible
  error.

Fix direction:

- Add `adminApi.recomputeTrustScore(userId)` and use the shared API client so
  non-2xx responses throw consistently.
- If raw `fetch()` remains, check `response.ok`, parse the error body, and show
  it via the page error state.
- Add a UI/service test that a 500 response leaves an error visible and does not
  present the action as successful.

Desired goal:

- Fraud operators get an explicit success or failure signal for trust recompute
  actions.

Done when:

- Failed recompute responses surface an error in the fraud page.
- Successful recomputes refresh the affected row/stats.
- The shared admin API surface includes the recompute operation.

### A-047: Consent Re-Prompt Hardcodes Policy Versions

Severity: medium.

Evidence:

- `apps/api/src/compliance/compliance.service.ts` defines
  `CURRENT_CONSENT_VERSIONS` for `privacy_policy`, `terms_of_service`, and
  `marketing_cookies`.
- `apps/api/src/compliance/compliance.controller.ts` exposes
  `GET /consent/required-versions` and `GET /consent/stale`.
- `apps/web/src/components/consent-reprompt.tsx` hardcodes
  `const VERSION = '2026-07-01'` and posts that same version for every stale
  purpose instead of using `/consent/required-versions`.
- `apps/web/src/components/cookie-consent.tsx` also hardcodes
  `version: '2026-07-01'` for `marketing_cookies`.

Likely impact:

- After a backend policy-version bump, the web banner can record the old version
  while locally hiding the prompt via `setStale([])`.
- If different consent purposes have different required versions, the UI cannot
  record the correct per-purpose version.
- Users may think they accepted the current terms/privacy policy while the
  backend still treats their consent as stale on the next session.

Fix direction:

- Fetch `/consent/required-versions` before recording consent and post the
  purpose-specific version returned by the API.
- Make cookie-banner consent use the same server-provided version source.
- If accepting fails or a stale purpose remains stale after recording, keep the
  prompt visible with an actionable error.

Desired goal:

- Consent prompts always record the server-required version for each purpose.

Done when:

- A policy-version bump in `ComplianceService` requires no web code change.
- The re-prompt flow records per-purpose versions and confirms the stale list is
  clear before dismissing.
- Tests cover accepting stale consent after changing the required version.

### A-048: Payout Account Verification Is Display-Only

Severity: high.

Evidence:

- `packages/db/prisma/schema.prisma` has `PayoutAccount.isVerified` with
  `@default(false)`.
- `PayoutService.addPayoutMethod()` creates the payout account but does not set
  `isVerified` or start a provider/admin verification workflow.
- `PayoutService.requestPayout()` validates user status, verified email, optional
  2FA, balance, fraud flags, account ownership, cooldown, and currency, but it
  does not require `account.isVerified`.
- `apps/web/src/app/developer/payouts/page.tsx` renders payout accounts as
  approved/pending based on `acc.isVerified`, but the payout-method selector
  includes all active accounts and does not block pending accounts.
- No scanned API/web path updates `PayoutAccount.isVerified` for developer-added
  payout accounts.

Likely impact:

- A newly added payout destination is shown as pending but can still be used to
  request a payout.
- The `isVerified` field gives users/admins a false sense of money-movement
  gating.
- Destination-verification, anti-takeover review, and provider onboarding are
  not actually enforced before funds can move.

Fix direction:

- Define what payout account verification means per provider: email challenge,
  provider account verification, admin approval, or trusted provider callback.
- Block `requestPayout()` unless the selected account is verified, or remove the
  field/UI label and make the product policy explicit.
- Add admin/provider endpoints to verify or reject payout accounts with audit
  logs.
- Filter/disable unverified payout accounts in the developer payout request UI.

Desired goal:

- Funds can only be requested to payout destinations that passed the intended
  verification workflow.

Done when:

- Newly added payout accounts cannot be used for payouts until verified.
- Verification/rejection actions are audited and visible to developers/admins.
- Tests cover payout request rejection for an unverified payout account.

### A-049: Web Logout Can Show Success Before Server Revocation/Cookie Clear

Severity: high.

Evidence:

- `apps/web/src/app/api/auth/logout/route.ts` is intentionally conservative:
  if the API logout call cannot be reached or returns a non-401 failure, it
  returns an error and does not clear auth cookies.
- `apps/web/src/lib/auth-context.tsx` calls `api.post('/auth/logout')` without
  awaiting it, logs failures in `.catch()`, immediately removes
  `lastDashboard`, and immediately sets `user` to `null`.
- If the route handler returns 502/5xx, the browser UI still behaves as if the
  user logged out, but the httpOnly cookies remain because the route handler did
  not clear them.

Likely impact:

- Users get a false sense that logout/revocation succeeded.
- A reload can rehydrate the session from still-present cookies and appear to
  "log back in" unexpectedly.
- An access token/session that the API failed to revoke remains usable until
  expiry or refresh failure.

Fix direction:

- Make `logout()` async and only clear local auth state after `/api/auth/logout`
  returns success.
- Surface a retryable logout error if revocation/cookie clearing fails.
- Consider a "force local sign-out" escape hatch only when the user explicitly
  accepts that server revocation is not confirmed.
- Add tests for API logout 502/500: local user state should not be cleared and
  protected pages should not claim logout succeeded.

Desired goal:

- The web UI's logged-out state matches server session revocation and cookie
  clearing.

Done when:

- A failed logout response leaves the user visibly authenticated with an error.
- A successful logout clears cookies and local auth state.
- Reload after a failed logout does not surprise the user with a resurrected
  session.

### A-050: Advertiser Report Date Ranges Exclude Most of the End Day

Severity: medium-high.

Evidence:

- `apps/web/src/app/advertiser/reports/page.tsx` sends date-only strings from
  `periodPreset()` via `toISOString().slice(0, 10)`.
- `AdvertiserController.getReports()` parses `to` with `new Date(to)`.
- `AdvertiserService.getReports()` applies that value directly as
  `createdAt: { gte, lte }`.
- A date-only `to=2026-07-09` parses to midnight at the start of that day, so
  events later on July 9 are excluded.

Likely impact:

- "Last 24h", "7 days", and custom ranges can under-report impressions, clicks,
  and spend for the selected end day.
- Advertisers can see spend/CTR totals that do not match billing ledger rows
  for the same apparent period.

Fix direction:

- Treat date-only `to` values as an exclusive next-day bound (`lt` next day) or
  expand to end-of-day consistently.
- Prefer explicit ISO datetimes for "last 24h" instead of date-only strings.
- Add tests for an event at noon on the selected `to` day.

Desired goal:

- Advertiser report periods include exactly the time range the UI label
  promises.

Done when:

- Last-24h and custom date-range reports include events within the selected end
  day.
- API tests cover date-only and datetime `from`/`to` inputs.
- Report totals reconcile with ledger spend for the same period.

### A-051: Campaign Creation Wizard Leaves Orphaned Drafts on Partial Failure

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

### A-052: Advertiser CTAs Land on Developer Signup by Default

Severity: medium-high.

Evidence:

- The landing page has advertiser-facing calls to action, including "Start
  Advertiser Campaign", but they link to `/auth/signup` without a role hint.
- `apps/web/src/app/auth/signup/page.tsx` initializes `role` to `developer`.
- The signup page only reads `ref` from the query string, and a referral code
  explicitly forces the role back to `developer`.
- There is no code path that reads something like `?role=advertiser` and
  selects the advertiser tab before the user fills the form.

Likely impact:

- Advertisers arriving from advertiser copy can accidentally create developer
  accounts.
- The first advertiser conversion path depends on the user noticing and
  manually switching the role tab.
- Google signup from that page will pass the currently selected role, so the
  wrong default can create the wrong account type before any dashboard recovery
  is possible.

Fix direction:

- Add explicit advertiser signup links, for example `/auth/signup?role=advertiser`.
- Teach the signup page to accept only valid role query values and initialize
  the segmented control from them.
- Keep referral links developer-only unless the product intentionally supports
  advertiser referrals.

Desired goal:

- Each public role-specific CTA lands on a signup form that is already in the
  matching role state.

Done when:

- Advertiser CTAs open the signup page with the advertiser role selected.
- Invalid role query values fall back safely.
- Tests cover developer, advertiser, referral, and invalid-role signup URLs.

### A-053: Redis Health Probe Can Latch a Failed Connection Forever

Severity: medium.

Evidence:

- `apps/api/src/health/redis-health.service.ts` stores the first connection
  attempt in `this.connectPromise`.
- If `client.connect()` rejects, `this.connectPromise` remains set to the
  rejected promise.
- Later health checks call `ensureClient()`, see `this.connectPromise`, and
  await the same rejected promise instead of creating a fresh Redis client.
- If an existing client becomes not ready, `ensureClient()` can also return the
  old fulfilled promise rather than resetting the client and reconnecting.

Likely impact:

- A transient Redis outage or startup race can make `/health` report Redis
  errors until the API process restarts, even after Redis is healthy again.
- Public status and operator readiness checks become less trustworthy.
- This compounds A-042 because the endpoint already returns HTTP 200 for
  dependency failures.

Fix direction:

- Clear `connectPromise` and `client` on connection failure.
- On ping failure or `!client.isReady`, dispose the stale client and retry with
  bounded backoff.
- Add tests for Redis unavailable on first check, then available on a later
  check.

Desired goal:

- The health probe reflects current Redis availability, not the outcome of the
  first connection attempt.

Done when:

- Redis health recovers without restarting the API.
- Tests cover initial failure, reconnect success, and stale-client failure.

### A-054: Confirmed Archive Refunds Do Not Reduce Advertiser Spendable Balance

Severity: high.

Evidence:

- `AdvertiserService.archiveCampaign()` records unspent archived budget as an
  advertiser ledger row with `entryType: 'refund'` and `status: 'pending'`.
- `AdminService.confirmArchiveRefund()` flips that row to `confirmed` after the
  admin manually issues the Stripe refund and writes the platform cash debit.
- Advertiser balance helpers ignore confirmed `refund` rows:
  `AdvertiserService.getAdvertiserBalance()`,
  `ExtensionService.getAdvertiserBalance()`, `CampaignService` balance checks,
  and the advertiser billing view all compute balance from only `credit` and
  `debit` entries.
- `ExtensionService.requestAd()` has the same issue in its advertiser
  eligibility prefilter, where only credits add and debits subtract.

Likely impact:

- After cash is refunded externally, the advertiser can still appear to have
  the same spendable platform balance.
- A refunded advertiser may resume/activate campaigns or receive ad delivery
  using money that has already left the platform.
- Billing pages can show a refund row in history while the available balance
  does not decrease, making reconciliation misleading.

Fix direction:

- Define the advertiser balance formula explicitly: confirmed credits minus
  confirmed debits minus confirmed refunds, plus/minus any dispute/reversal
  states the ledger supports.
- Centralize the balance calculation instead of duplicating it across
  advertiser, campaign, extension, admin, and UI response code.
- Add an integration test: deposit, archive campaign, confirm refund, then
  verify balance, activation/resume, and ad-serving eligibility all reflect the
  refunded cash outflow.

Desired goal:

- Once an advertiser refund is confirmed, that cash cannot be spent again.

Done when:

- Confirmed refund rows reduce advertiser available balance.
- Campaign activation/resume and ad serving reject campaigns whose only funding
  was already refunded.
- Billing/dashboard totals reconcile deposits, debits, refunds, disputes, and
  spendable balance by currency.

### A-055: Advertiser Balance Is Not Atomically Reserved or Guarded During Billing

Severity: high.

Evidence:

- `ExtensionService.requestAd()` filters campaigns with a read-only advertiser
  balance precheck before serving an ad.
- `recordQualifiedImpression()` and `recordClick()` call
  `getAdvertiserBalance()` before the billing transaction, but the transaction
  only atomically increments `campaign.budgetSpentMinor` and inserts ledger
  rows.
- There is no advertiser-level balance row, reservation, advisory lock, or SQL
  condition that prevents two concurrent billable events on different campaigns
  from both reading the same available balance and both inserting debits.
- Campaign-level budget is protected, but account-level cash is not.

Likely impact:

- Two campaigns under the same advertiser can concurrently spend the same
  remaining balance.
- Advertiser ledger can go negative even when every individual campaign stayed
  within its own budget.
- Developer earnings and platform fees can be created from advertiser funds
  that were not actually available.

Fix direction:

- Introduce an advertiser/currency balance reservation model, or perform
  billing under an advertiser+currency lock with an in-transaction balance
  check.
- Use the same balance formula from A-054, including refunds/disputes, inside
  the atomic guard.
- Add concurrent CPM and CPC tests with two active campaigns sharing one small
  advertiser balance.

Desired goal:

- Every billable event consumes advertiser cash exactly once and cannot overdraw
  the advertiser's available balance.

Done when:

- Concurrent cross-campaign billing cannot make advertiser balance negative.
- CPM qualification and CPC click paths use the same atomic account-level cash
  guard.
- Tests prove one of two concurrent events is rejected when only one bid remains
  funded.

### A-056: Country Targeting Is Stored but Not Enforced During Ad Selection

Severity: high.

Evidence:

- `apps/web/src/app/advertiser/campaigns/new/page.tsx` collects comma-separated
  country codes and calls `campaignApi.setCountryTargeting()`.
- `CampaignService.setCountryTargeting()` persists `CountryTargeting` rows.
- `ExtensionService.requestAd()` includes `countryTargeting: true` when loading
  campaigns, but the eligibility filter never checks those rows.
- `AdRequestDto` has no country field, and the VS Code extension's
  `requestAd()` payload sends only device/session/wait/tool/idempotency data.
- Public copy promises "Country & tool targeting", but the current ad request
  path has no country input and no tool-targeting model beyond the broad
  `toolType` event value.

Likely impact:

- Advertisers can configure country targeting and believe it is active, while
  their ads may serve to any developer.
- Spend, CTR, and invalid-traffic analysis become misleading because targeting
  constraints were not actually applied.
- Tool targeting is advertised but not available as a campaign-level delivery
  rule.

Fix direction:

- Decide the privacy-safe source of country: account profile, coarse IP
  geolocation, explicit developer setting, or no country targeting at launch.
- Add country to the server-side eligibility context and filter
  `CountryTargeting` rows consistently.
- Either implement tool targeting in the campaign model/API/UI and filter by
  `toolType`, or remove/soften public claims until it exists.

Desired goal:

- Targeting controls shown to advertisers are enforced by the delivery engine.

Done when:

- Campaigns with include/exclude country rules only serve in matching delivery
  contexts.
- Tool targeting is either implemented end-to-end or removed from launch copy.
- Tests cover matching country, excluded country, no targeting, and tool-type
  eligibility.

## End-to-End SaaS Readiness Checks

Do not declare WaitLayer SaaS-ready until these flows pass against a fresh,
migrated environment with production-like web/API configuration.

### Developer Flow: Landing Page to Payout

Required path:

1. Public landing page loads with correct links to signup, login, pricing,
   policies, contact, and developer onboarding.
2. Developer signs up through each supported signup surface and the API records
   required age, terms, privacy, and consent-version proof before account
   creation.
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
9. Client starts and ends a wait state with signed payloads.
10. Approved/funded advertiser campaign is eligible and ad request returns a
   valid creative for the correct account/device/currency context.
11. Client renders an ad, qualifies an impression after minimum visible
    duration, and optionally records a click. Terminal/CLI earning claims must
    pass this step too or be explicitly excluded from launch copy.
12. Advertiser is debited, developer earnings are credited, platform/reserve
    ledgers reconcile, and fraud checks can hold/release earnings.
13. Ledger maturation makes earnings confirmed after the correct hold period.
14. Developer adds a verified payout method.
15. Developer requests payout only after threshold, email verification, and
    fraud/2FA/API-key safety requirements are satisfied.
16. Admin reviews/approves/processes payout or the automated provider processes
    it.
17. Payout is marked paid by provider webhook or audited admin action.
18. Developer payout history, ledger balance, payoutable referral reward logic,
    privacy preferences, and export data all reflect the final state.
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
   ledger is credited, and billing page shows confirmed balance.
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
    CTR, date ranges, and currency breakdown.
13. Advertiser can pause, resume, edit eligible drafts/rejections, and archive
    campaigns.
14. Archive creates the expected refund obligation; admin confirms manual Stripe
    refund or an automated provider handles it, and confirmed refunds reduce
    advertiser spendable balance.
15. Refunds/disputes webhooks update advertiser ledger, platform cash ledger,
    campaign eligibility, spendable balance, and fraud/recovery queues.
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
9. Ops has runbooks for failed webhooks, failed payout providers, migration
   rollback, and money reconciliation.

Admin flow fails SaaS readiness if an operational action exists only as a raw API
call, direct database mutation, or tribal-knowledge script.

## Recommended Fix Order

1. Fix A-002, A-004, A-005, A-015, A-016, A-017, A-027, A-049, and any related
   proxy/env tests because they are web auth/proxy/config contract bugs.
2. Fix A-034, A-036, A-044, A-047, and A-052 so signup and privacy obligations
   are enforced across roles, versions, and surfaces.
3. Fix A-013, A-014, A-040, and A-043 so developer clients can be installed,
   connect, authenticate, and complete the intended earning path.
4. Fix A-035, A-037, and A-048 so 2FA/API-key/payout-destination behavior
   matches the money-movement security policy.
5. Fix A-019, A-020, A-021, A-022, A-023, A-024, A-038, A-039, A-050, A-051,
   A-054, A-055, and A-056 to make the advertiser
   campaign/ad-serving/billing/reporting loop coherent.
6. Fix A-041 so referral rewards match payout accounting.
7. Fix A-003 and A-012 so tests and schema setup become trustworthy.
8. Fix A-001 so root, CI, and Docker builds are release-safe.
9. Add the A-006 regression tests while fixing those contract bugs.
10. Fix A-025, A-026, A-028, A-045, A-046, and the admin portions of the E2E
    readiness checks.
11. Fix A-042 and A-053 before relying on container/load-balancer readiness.
12. Address A-007, A-008, A-009, A-030, A-031, and A-032 as product hardening
    and scale work.
13. Update stale status docs for A-010 and public claims in A-033 only after
    commands and E2E checks are genuinely green.
14. Keep A-011 in mind throughout: do not combine unrelated fixes.

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
