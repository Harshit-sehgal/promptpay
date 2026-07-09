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

Snapshot date: 2026-07-09 (re-verified 2026-07-09 after fresh audit pass).

Observed verification state from the codebase audit:

- `pnpm typecheck`: passed (14/14 successful, full monorepo including web/cli/
  vscode/api/shared).
- `pnpm lint`: passed (per earlier snapshot, full monorepo lint).
- `pnpm test`: passed (9/9 tasks; all suites green, including the 42-test
  API e2e-http flow and the 44-test API e2e-money-loop).
- `pnpm build`: passed (9/9 tasks; root pnpm build now completes the Next.js
  build successfully, removing the previously-reported .next/pages-manifest
  error).
- `pnpm --filter waitlayer-web build`: passed when run directly.

Important caveat: this is a snapshot. Re-run the commands before starting and
before declaring the repo healthy.

Additional recheck caveat from the current dirty tree:

- Several older issue descriptions have partial code-level fixes in the current
  worktree. Re-verify the named files before acting on A-007, A-019, A-024,
  A-025, A-026, A-027, A-034, A-036, A-037, A-039, A-040, A-042, A-043, A-044,
  A-047, A-048, A-049, A-050, A-052, A-053, A-054, and A-055. The residual
  current gaps found in this pass are captured in A-062 through A-068, or in
  current-status notes on the older entry, rather than assuming the older
  wording is still exact.

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

### A-026: Admin Payout Page Does Not Compile and Has Amount-Unit Bugs

Severity: high.

Evidence:

- `AdminService.getPendingPayouts()` includes `user.email`, `user.name`,
  `trustLevel`, payout account, status, and latest transaction.
- `apps/web/src/app/admin/payouts/page.tsx` now contains partial-approval and
  manual-reconciliation modal code, but `pnpm --filter waitlayer-web typecheck`
  fails with `TS1128` at lines 484-487 because the file ends with stray
  `}, } }` tokens.
- `openApproveModal()` and `openReconcileModal()` compute defaults with
  `p.approvedAmountMinor ?? p.requestedAmountMinor / 100`. When
  `approvedAmountMinor` is set, the minor-unit amount is displayed as a major
  amount. A `3000` minor-unit approval defaults to `3000`, not `30.00`.
- `handleReconcile()` multiplies the displayed value by 100 before calling
  `adminApi.markPayoutPaid()`, so a partial approval can attempt to reconcile
  100x the approved amount and then fail backend cross-checks.

Likely impact:

- The web app cannot typecheck/build while this syntax error remains.
- Admin payout review, partial approval, and manual reconciliation are broken in
  the browser even though the backend paths exist.
- If the syntax is fixed without the amount-unit fix, partial payout
  reconciliation can submit wrong values.

Fix direction:

- Remove the stray trailing tokens and run the web typecheck.
- Convert `approvedAmountMinor` to major units before pre-filling modal inputs.
- Add UI tests for full approval, partial approval, processing, and manual
  mark-paid reconciliation.

Desired goal:

- Admins can review, approve, partially approve, process, reject, and reconcile
  payouts entirely from the admin UI.

Done when:

- Partial approval is usable and cross-checked.
- Manual payout reconciliation can mark paid without requiring a pre-created
  transaction that the UI cannot supply.
- `pnpm --filter waitlayer-web typecheck` passes.

### A-027: Device Recovery Exists but Is Hidden and Requires Manual IDs

Severity: medium.

Evidence:

- `AdminController` exposes `POST /admin/devices/:id/recovery-token`.
- The web proxy allowlist includes `/admin/devices`, and `adminApi` exposes
  `issueDeviceRecoveryToken()`.
- `apps/web/src/app/admin/devices/page.tsx` exists and can issue a token, but
  `apps/web/src/app/admin/layout.tsx` does not include a navigation item for
  `/admin/devices`.
- The page requires the operator to manually know both device UUID and user UUID;
  there is no user/device detail view or lookup path from the user table.
- CLI and VS Code clients explicitly prompt for/use support-issued recovery
  tokens.

Likely impact:

- The support flow exists but is difficult to discover and depends on IDs that
  the admin UI does not help operators find.
- Legitimate device recovery can still fall back to ad hoc database/API lookup.

Fix direction:

- Add `/admin/devices` to the admin navigation.
- Add an admin/support UI flow from user/device details or a searchable device
  lookup.
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

### A-034: Signup Consent Is Enforced in API/Web but Still Drifts Across Surfaces

Severity: high.

Evidence:

- `apps/api/src/auth/dto/signup.dto.ts` now requires `ageConfirmed` and
  `termsAccepted`, with optional `policyVersion`.
- `AuthService.signUp()` rejects missing consent and persists
  `terms_of_service` and `privacy_policy` consent records.
- `AuthService.googleOAuth()` also rejects first-time Google signup without
  `ageConfirmed` and `termsAccepted`, then persists consent records.
- `apps/web/src/app/auth/signup/page.tsx` gates email/password and Google signup
  on one `ageConfirmed` checkbox, then sends `termsAccepted: true`.
- The visible checkbox copy says the user is 18+ and has read the Privacy
  Policy; the Terms of Service agreement is only in a footer line, not a
  separate required checkbox or explicit link at the control.
- The web signup page hardcodes `policyVersion: '2026-07-01'` for
  email/password, Google, and mock Google signup.
- `apps/cli/src/commands/auth.ts` still calls `api.signup()` without
  `ageConfirmed`, `termsAccepted`, or `policyVersion`; A-065 tracks the
  resulting terminal signup breakage.

Likely impact:

- Direct API and web Google signup are no longer broad consent bypasses, but
  the web UI can still record Terms acceptance without an explicit terms
  checkbox/link at the required control.
- A backend policy-version bump requires signup-page code changes or new users
  will keep recording the old `2026-07-01` version.
- CLI signup fails against the current API contract unless the CLI is updated or
  signup is intentionally removed from the terminal product.

Fix direction:

- Split or rewrite the signup consent control so it explicitly covers age,
  Terms of Service, and Privacy Policy at the point of acceptance.
- Fetch current required policy versions from the API instead of hardcoding
  `2026-07-01` in the signup page.
- Update CLI signup to prompt for the same acceptance and send the required
  fields, or remove/disable CLI signup until it can collect consent.

Desired goal:

- Every self-service account creation path proves the user accepted the current
  required terms/privacy versions and age requirement before the user row is
  created.

Done when:

- API DTOs and services reject missing required signup consent for all signup
  paths.
- Web Google and email/password signup use server-provided policy versions.
- CLI signup prompts for the same acceptance or refuses signup with a clear
  message.
- Tests cover email/password, Google, CLI/direct API, missing-consent rejection,
  and policy-version bump behavior.

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

### A-036: CCPA Opt-Out Is Recorded but Not Enforced in Backend Behavior

Severity: high.

Evidence:

- `apps/web/src/app/privacy/page.tsx` stores `wl_ccpa_opt_out` locally for all
  visitors and, for authenticated users, posts `/consent` with
  `purpose: 'ccpa_opt_out'`.
- `ComplianceController` and `ComplianceService` can record and read arbitrary
  consent purposes, so authenticated opt-out storage now exists.
- `rg` finds no `ccpa_opt_out` or `ComplianceService.isConsented()` checks in
  `ExtensionService.requestAd()`, advertiser reporting, campaign targeting, or
  other backend data-sharing paths.
- The unauthenticated path remains device-local by design and the page says so.

Likely impact:

- Authenticated opt-outs can follow the user across devices, but the backend
  does not appear to change any product behavior based on the recorded flag.
- Ad-serving, reporting, targeting, or advertiser data use can continue exactly
  as before after opt-out.
- Operators have a consent record, but no enforcement contract to audit.

Fix direction:

- Define what `ccpa_opt_out` must do in this product: ad selection, targeting,
  reporting, data export, or advertiser sharing.
- Enforce that behavior in backend paths, or make the UI/legal copy state that
  the toggle is a recorded request rather than an immediate runtime control.
- Keep logged-out local-only wording explicit or provide an identity-tied
  request workflow.

Desired goal:

- Privacy choices that affect platform behavior are durable, auditable, and
  enforced server-side.

Done when:

- CCPA opt-out can be recorded and retrieved from the backend.
- The backend has a documented behavior for opt-out during ad selection,
  reporting, and advertiser data use.
- The UI distinguishes local-only preferences from account-level legal
  preferences.

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

Severity: medium.

Evidence:

- `apps/cli/package.json` is now `"private": false`, has
  `bin.waitlayer: "./dist/index.js"`, a `files: ["dist"]` whitelist, and
  `publishConfig.access: "public"`.
- `scripts/verify-cli-bin.mjs` checks that the built CLI bin path exists after
  build.
- `.github/workflows/publish-cli.yml` builds the CLI, runs the bin verifier, and
  performs `pnpm pack --dry-run`, but the real `npm publish` step is commented
  out.
- `apps/vscode-extension/package.json` has `package:vsix` and `publish:vsix`
  scripts.
- `.github/workflows/publish-vscode.yml` builds and packages a `.vsix`, but the
  marketplace publish step is commented out.
- Both publish workflow files are currently untracked in this dirty worktree, so
  they are not guaranteed to exist in the committed branch.
- A-013 separately covers the localhost default once a package is installed.

Likely impact:

- Client artifact packaging is closer, but public install still depends on
  uncommenting/approving publish steps and committing the workflow files.
- Release dry-runs can pass while no npm package or Marketplace extension is
  actually published for users.

Fix direction:

- Commit the publish workflows and decide the explicit approval gate for real
  `npm publish` and Marketplace publish.
- Include smoke tests that install the packaged artifacts and run login/config
  commands against a production-like API URL.
- Record where release artifacts are downloaded by users and how rollback works.

Desired goal:

- Users can install signed/versioned client artifacts without cloning the
  monorepo.

Done when:

- CLI and VS Code artifacts are built from CI/release workflow outputs.
- Packaged artifacts have production-safe defaults and pass install smoke
  tests.

### A-044: Advertiser Privacy Endpoints Exist but Are Not Safely Exposed in UI

Severity: medium.

Evidence:

- `AdvertiserController` now exposes `POST /advertiser/export-data` and
  `POST /advertiser/delete-account`.
- The Next.js proxy allowlist includes `/advertiser/export-data` and
  `/advertiser/delete-account`, and `advertiserApi` has matching methods.
- There is no advertiser settings/account page under `apps/web/src/app/advertiser`;
  `rg` finds no `advertiserApi.exportData()` or `advertiserApi.deleteAccount()`
  usage in advertiser UI pages.
- Advertiser deletion only checks `confirmation === 'DELETE_MY_ACCOUNT'` in the
  controller. Unlike `DeveloperService.deleteAccount()`, it does not require
  password or Google step-up reauthentication before anonymizing the user.
- The admin erasure endpoint exists, but A-028 notes it is still not exposed in
  the admin Users UI.

Likely impact:

- Advertiser export/delete paths are direct API-only from the current web
  product; normal advertiser users have no discoverable account/privacy screen.
- A stolen active advertiser session can delete the account with only a typed
  confirmation string if the attacker reaches the endpoint.
- GDPR/CCPA request handling for advertisers is only partially productized.

Fix direction:

- Add account/privacy settings for advertiser users with export and deletion
  controls.
- Reuse the developer deletion step-up model for advertiser deletion, including
  current password or Google reauthentication where applicable.
- Keep money-retention/legal-hold records intact while anonymizing personal and
  billing identity.
- Add UI/proxy/API tests for advertiser export, deletion, and step-up failure.

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

### A-047: Signup Still Hardcodes Policy Version After Re-Prompt Fixes

Severity: medium.

Evidence:

- `apps/api/src/compliance/compliance.service.ts` defines
  `CURRENT_CONSENT_VERSIONS` for `privacy_policy`, `terms_of_service`, and
  `marketing_cookies`.
- `apps/api/src/compliance/compliance.controller.ts` exposes
  `GET /consent/required-versions` and `GET /consent/stale`.
- `apps/web/src/components/consent-reprompt.tsx` now fetches
  `/consent/required-versions`, posts the required version per stale purpose,
  and re-checks `/consent/stale` before dismissing.
- `apps/web/src/components/cookie-consent.tsx` now fetches the required
  `marketing_cookies` version before recording accepted cookie consent.
- `apps/web/src/app/auth/signup/page.tsx` still hardcodes
  `policyVersion: '2026-07-01'` for email/password signup, Google signup, and
  mock Google signup.
- Cookie decline stores only local `declined` state; it does not record an
  authenticated server-side `marketing_cookies` revocation, leaving the stale
  consent/re-prompt semantics unclear for users who decline optional cookies.

Likely impact:

- After a backend policy-version bump, new web signups can keep recording the
  old `2026-07-01` acceptance until the signup page is changed.
- A user who declines optional marketing cookies may have only local decline
  state, not an auditable account-level revocation.
- Re-prompt and cookie acceptance are closer to the desired contract, but signup
  and decline flows still drift from server-owned policy versions.

Fix direction:

- Fetch `/consent/required-versions` before signup submission and send the
  correct terms/privacy version instead of a hardcoded constant.
- For authenticated cookie decline, record `marketing_cookies` with
  `granted: false` and the server-required version, or explicitly define why
  decline is local-only.
- Keep the existing re-check behavior that prevents dismissing stale consent
  when server recording fails.

Desired goal:

- Consent prompts always record the server-required version for each purpose.

Done when:

- A policy-version bump in `ComplianceService` requires no web code change.
- The re-prompt flow records per-purpose versions and confirms the stale list is
  clear before dismissing.
- Signup and cookie decline flows also use server-owned versions.
- Tests cover accepting stale consent, declining optional cookies, and signing
  up after changing the required version.

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
  unverified payout accounts, though A-026 currently blocks the admin payout
  page from compiling.
- `apps/api/src/payout/payout.service.spec.ts` covers rejection of unverified
  payout destinations.

Residual risk:

- The web typecheck failure in A-026 prevents relying on the admin verification
  UI until that page builds.
- Provider-specific automated verification is still a product/process decision,
  but the platform now has an admin gate.

Follow-up direction:

- Define what payout account verification means per provider: email challenge,
  provider account verification, admin approval, or trusted provider callback.
- Keep admin verification/rejection visible after A-026 is fixed.
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
- A full web typecheck is currently blocked by A-026, so logout verification
  should be re-run after the web compile blocker is fixed.

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

Severity: medium.

Evidence:

- `apps/web/src/app/auth/signup/page.tsx` initializes `role` to `developer`.
- The signup page now reads `?role=advertiser` / `?role=developer` and selects
  the matching tab; referral links still force developer.
- The main landing page "Start Advertiser Campaign" CTA links to
  `/auth/signup?role=advertiser`.
- The pricing page advertiser card "Start advertising" links to
  `/auth/signup?role=advertiser`.
- Several mixed-audience/generic CTAs still link to `/auth/signup`, including
  the landing hero "Start earning" and pricing "Get started" / bottom CTA,
  which correctly default to developer only if the copy is developer-leaning.

Likely impact:

- The strongest advertiser-specific CTAs now preselect advertiser, but any
  generic CTA near mixed developer/advertiser copy still needs copy/link review
  to avoid accidentally defaulting advertiser visitors to developer signup.
- Google signup still uses the currently selected role, so any remaining
  advertiser-intended link without a role hint can create the wrong account
  type.

Fix direction:

- Audit every public `/auth/signup` link and classify it as developer-specific,
  advertiser-specific, or intentionally generic.
- Add explicit advertiser signup links anywhere the surrounding copy is
  advertiser-specific.
- Keep referral links developer-only unless the product intentionally supports
  advertiser referrals.

Desired goal:

- Each public role-specific CTA lands on a signup form that is already in the
  matching role state.

Done when:

- Advertiser CTAs open the signup page with the advertiser role selected.
- Invalid role query values fall back safely.
- Tests cover developer, advertiser, referral, and invalid-role signup URLs.

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

### A-057: Developer Category Blocking Has No Persisted Settings or Client Path

Severity: medium-high.

Evidence:

- The landing page says developers can "Block categories" and the FAQ says
  category blocking is available from the settings dashboard.
- `UserSettings` only stores `adsEnabled`, quiet-mode fields, and
  `maxAdsPerHour`.
- `UpdateSettingsDto`, `DeveloperService.updateSettings()`, and
  `apps/web/src/app/developer/settings/page.tsx` have no category preference
  fields or controls.
- `AdRequestDto` has optional `allowedCategories` and `blockedCategories`, and
  `ExtensionService.requestAd()` filters on those DTO fields, but the VS Code
  extension's `requestAd()` payload never sends either field.
- The `BlockedCategory` model appears to be an admin/user-generated report
  table with `blockedBy` and `reason`; it is not wired as a per-developer ad
  preference.

Likely impact:

- Developers cannot actually block advertiser categories through the product.
- Any category filtering depends on a client voluntarily sending transient
  arrays that current clients do not send.
- Public privacy/control claims overstate the current developer preference
  surface.

Fix direction:

- Add persisted per-developer category preferences, or remove category-blocking
  claims until implemented.
- Have extension/CLI fetch settings and include/enforce the persisted category
  preferences, or have the API apply them directly during ad selection.
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

Severity: medium-high.

Evidence:

- `UserSettings` stores `quietModeStart` and `quietModeEnd` as `HH:MM` strings
  without a timezone.
- `ExtensionService.requestAd()` calls `currentTimeHHMM()` on the API server and
  compares that server-local value to the user's quiet-mode window.
- The VS Code extension and CLI ad/request flows do not send a local timezone,
  offset, or local time context.
- The settings UI presents quiet mode as a developer preference, implying it
  applies to the developer's local hours.

Likely impact:

- Developers outside the API server timezone can receive ads during their
  intended quiet hours or have ads suppressed at the wrong time.
- Operators cannot reason about quiet-mode behavior across regions.
- Tests running in one timezone can pass while production users in another
  timezone see incorrect behavior.

Fix direction:

- Store a timezone/offset with developer settings, or have clients send a
  signed local-time context and validate it carefully.
- Prefer IANA timezone storage for account settings so daylight-saving changes
  are handled predictably.
- Add tests with a developer timezone different from the server timezone.

Desired goal:

- Quiet mode is evaluated in the developer's intended local time.

Done when:

- A developer in a non-server timezone has ads suppressed only during their
  configured local quiet window.
- Settings UI shows the timezone used for quiet mode.
- Tests cover same-day and overnight quiet windows across timezones.

### A-059: Partial Payout Approval Can Mark Too Much Earnings as Paid

Severity: high.

Evidence:

- `AdminService.approvePayout()` accepts `approvedAmountMinor`, so the backend
  supports approving less than the originally requested payout amount.
- `PayoutService.processPayout()` reconciles a partial approval by trimming
  `PayoutAllocation.amountMinor` rows until their sum matches the approved
  amount.
- `PayoutAllocation` stores its own `amountMinor`, but the linked
  `EarningsLedger` row still has a single whole-row `amountMinor` and `status`.
- `PayoutService.markPayoutPaid()` and the Stripe payout webhook collect
  allocated earnings ids and update matching `EarningsLedger` rows to
  `status: 'paid'` by id; they do not split or mark only the allocated amount.
- If an allocation is shrunk during partial approval, the whole earnings row can
  still be marked paid even though only part of that row was actually paid out.
- The admin payout UI does not expose partial approval, but the backend API path
  exists and tests cover partial approval as a supported service behavior.

Likely impact:

- A developer can lose the unpaid remainder of an earnings row after a partial
  payout is marked paid.
- Ledger balances can show less confirmed earnings than actually remain owed.
- Admins may believe partial approval is safe because the API validates the
  approved amount and `processPayout()` trims allocations, while the terminal
  paid transition still acts at whole-row granularity.

Fix direction:

- On partial approval, split the underlying `EarningsLedger` rows so every
  remaining allocation points to an earnings row whose `amountMinor` exactly
  equals the paid allocation.
- Alternatively, replace whole-row earnings status with amount-level payout
  settlement accounting, but that is a larger ledger model change.
- Add integration tests for a single large earning partially approved, paid,
  and then re-requested for the unpaid remainder.

Desired goal:

- Partial payout approval pays exactly the approved amount and leaves the unpaid
  remainder available or held with an explicit reason.

Done when:

- Marking a partially approved payout paid cannot mark more earnings as paid
  than the approved payout amount.
- Developer payout availability after partial payment equals the unpaid
  confirmed remainder.
- Admin and webhook paid paths share the same amount-level reconciliation.

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

Severity: critical.

Evidence:

- `StripeWebhookController.handleWebhook()` is annotated with
  `@HttpCode(HttpStatus.OK)`.
- Missing Stripe signature, missing raw body, and signature verification failure
  all return `{ received: false, reason: ... }` instead of throwing or setting a
  non-2xx status.
- `handlePaymentSuccess()` returns early when checkout metadata lacks
  `advertiserId` or the advertiser row is missing, but those early returns do
  not mark the `webhookEvent` row `processed`, `failed`, or `pending`.
- `WEBHOOK_ASYNC_PROCESSING=true` acknowledges the event immediately with
  `{ received: true, reason: 'accepted_async' }` and then runs an in-process
  `setImmediate()` handler. If that handler fails it resets the row to
  `pending`, but there is no background worker that drains pending webhook rows;
  Stripe already received HTTP 200.

Likely impact:

- A legitimate Stripe deposit/refund/dispute/payout event can be dropped from
  the provider's retry perspective while the platform fails to reconcile money.
- Webhook secret/raw-body misconfiguration can produce successful HTTP
  responses and no ledger updates, which is dangerous during launch.
- Async webhook mode is not crash-safe: a process death after the 200 response
  can leave the only durable record in `processing` or `pending` until a manual
  replay.

Fix direction:

- Return a non-2xx response for verification/configuration failures before an
  event is durably accepted.
- For accepted events, ensure every branch reaches a terminal `processed`,
  durable `failed`, or retryable state with an explicit error reason.
- If async mode remains, add a durable worker that claims and processes pending
  webhook rows independently of provider redelivery.
- Add integration tests for missing signature, bad signature, missing raw body,
  missing advertiser metadata, missing advertiser row, async handler failure,
  and process-restart replay.

Desired goal:

- Stripe receives HTTP 200 only after the event is durably accepted and either
  processed or guaranteed to be retried by the platform.

Done when:

- Misconfigured or invalid webhook requests return non-2xx.
- Accepted-but-failed events are visible in admin operations and automatically
  retry without requiring a new Stripe delivery.
- Deposits cannot be lost silently due to missing metadata or async process
  failure.

### A-063: Partial Stripe Disputes Freeze or Write Off Entire Deposits

Severity: high.

Evidence:

- `handleDispute()` creates a `hold` advertiser-ledger row for
  `Math.min(entry.amountMinor, details.amountMinor)`, which is amount-level.
- The same transaction then flips the parent deposit credit row to
  `status: 'held'` regardless of whether the dispute amount is smaller than the
  deposit amount.
- The centralized spendable-balance helper counts only `status: 'confirmed'`
  credits, so a partially disputed deposit is fully removed from spendable
  balance.
- `handleDisputeClosed()` lost-dispute handling writes a parent reversal for
  `details.amountMinor`, then marks the parent credit row `status: 'reversed'`,
  again excluding the entire original credit.

Likely impact:

- A partial dispute can freeze the advertiser's whole deposit instead of only
  the disputed amount.
- A lost partial dispute can write off the whole deposit from advertiser
  spendable balance while platform cash is debited only for the smaller dispute
  amount, making ledgers inconsistent.
- Active campaigns may stop serving because unrelated, undisputed funding was
  hidden by a whole-row status flip.

Fix direction:

- Split deposit credit rows before holding/reversing a disputed slice, or model
  dispute holds at amount level without changing whole parent-row status.
- Keep undisputed remainder credits confirmed and spendable.
- Add tests for a $100 deposit with a $10 dispute created, won, lost, and
  re-delivered.

Desired goal:

- Dispute lifecycle changes only the disputed amount, never unrelated funding.

Done when:

- Partial disputes freeze exactly the disputed amount.
- Winning a partial dispute restores exactly that amount.
- Losing a partial dispute reverses exactly that amount and leaves the remaining
  deposit credit spendable.

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

### A-065: CLI Signup Cannot Satisfy Required Consent Fields

Severity: high.

Evidence:

- `SignUpDto` requires `ageConfirmed` and `termsAccepted` booleans.
- `AuthService.signUp()` rejects account creation when either field is missing
  or false.
- `apps/cli/src/commands/auth.ts` calls `api.signup()` with email, password,
  role, name, and optional referral code only.
- `apps/cli/src/lib/api-client.ts` `signup()` does not accept or forward
  `ageConfirmed`, `termsAccepted`, or `policyVersion`.

Likely impact:

- CLI self-service signup fails against the current API validation.
- Developers installing the terminal client first cannot create an account from
  the CLI even though the command offers signup.
- The older consent-bypass risk has become a broken-client risk in the current
  tree: the API is stricter, but this client was not updated.

Fix direction:

- Add explicit CLI prompts for age confirmation and terms/privacy acceptance.
- Forward `ageConfirmed: true`, `termsAccepted: true`, and the current
  server-required policy version.
- Fetch the required policy versions from `/consent/required-versions` or share
  the version constant through a package instead of hard-coding a stale value.

Desired goal:

- Every signup surface enforces and records the same age/terms/privacy consent.

Done when:

- CLI signup succeeds only after explicit consent.
- The consent rows are created for CLI signups with the current policy version.
- Tests cover declined consent, accepted consent, and policy-version forwarding.

### A-066: Advertiser Billing Display Still Ignores Confirmed Refunds

Severity: high.

Evidence:

- The current code has a centralized `getAdvertiserBalance()` helper that
  subtracts confirmed `refund` rows for spend eligibility.
- `AdvertiserService.getBilling()` still performs its own grouped query with
  `entryType: { in: ['credit', 'debit'] }` and computes
  `balanceMinor = totalDepositsMinor - totalChargesMinor`.
- Confirmed archive refunds created by `AdminService.confirmArchiveRefund()` are
  `entryType: 'refund'`, `status: 'confirmed'`, so they are listed in recent
  entries but excluded from billing totals and balance cards.
- The advertiser billing page renders `balanceMinor`, `totalDepositsMinor`, and
  `totalChargesMinor` from that endpoint.

Likely impact:

- After a refund is confirmed, the billing page can still show a higher account
  balance than the spendable balance used by campaign serving.
- Advertisers may see a refund row in history while the summary balance does
  not decrease.
- Support and advertisers can disagree about whether refunded funds are still
  available.

Fix direction:

- Reuse the centralized advertiser balance helper or extend the billing
  aggregate to include refunds.
- Add `totalRefundsMinor` / `refundsByCurrency` to the billing response so the
  balance math is explicit.
- Add an integration/UI test for deposit -> archive -> refund confirm ->
  billing page balance.

Desired goal:

- Advertiser billing totals match the spendable-balance formula used for ad
  serving and campaign activation.

Done when:

- Confirmed refund rows reduce displayed advertiser balance.
- Billing summary exposes deposits, charges, refunds, and final balance by
  currency.
- The displayed balance matches the backend delivery eligibility balance.

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

### A-068: Reports Daily Trend Still Loads All Event Timestamps Into Memory

Severity: medium.

Evidence:

- `AdvertiserService.getReports()` now uses `groupBy()` for campaign-level
  impression and click totals.
- The same method still builds `dailyTrend` by calling
  `adImpression.findMany({ select: { createdAt: true } })` and
  `adClick.findMany({ select: { createdAt: true } })` for every matching event
  in the requested range.
- `params.page` and `params.limit` are accepted in the service signature but are
  not applied to the event timestamp queries.
- The reports page offers 90-day and custom date ranges, and the export route
  reuses `getReports()`.

Likely impact:

- Large advertisers can force the API to load millions of event timestamps into
  Node memory just to draw a daily trend chart.
- The report endpoint can become slow or OOM despite the campaign totals being
  database-aggregated.
- The older raw-row report issue is only partially fixed in the current tree.

Fix direction:

- Aggregate daily impressions/clicks in SQL using date bucketing, or maintain a
  rollup table.
- Cap custom date ranges or page the event timeline separately from campaign
  summary rows.
- Add a regression test that asserts report generation does not call raw
  `findMany()` for every event row in a large date range.

Desired goal:

- Advertiser reporting remains bounded in memory for large customers and long
  ranges.

Done when:

- Daily trend is generated by database aggregation or bounded rollups.
- Custom ranges have explicit limits or a safe asynchronous export path.
- Large synthetic report tests pass without loading raw event rows into memory.

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

1. Fix A-002, A-004, A-005, A-015, A-016, A-017, and any related
   proxy/env tests because they are web auth/proxy/config contract bugs.
2. Fix A-034, A-036, A-044, A-047, A-052, and A-065 so signup and privacy
   obligations are enforced across roles, versions, and surfaces.
3. Fix A-013, A-014, A-040, A-043, and A-064 so developer clients can be
   installed, connect, authenticate, and complete the intended earning path.
4. Fix A-035 and A-037 so 2FA and API-key behavior match the money-movement
   security policy.
5. Fix A-019, A-020, A-021, A-022, A-023, A-024, A-038, A-039, A-051,
   A-056, A-059, A-060, A-061, A-062, A-063, A-066, A-067, and
   A-068 to make the advertiser/developer money campaign/ad-serving/billing/
   reporting loop coherent.
6. Fix A-041 so referral rewards match payout accounting.
7. Fix A-003 and A-012 so tests and schema setup become trustworthy.
8. Fix A-001 so root, CI, and Docker builds are release-safe.
9. Add the A-006 regression tests while fixing those contract bugs.
10. Fix A-026, A-027, A-028, A-045, A-046, and the admin portions of the E2E
    readiness checks.
11. Address A-007, A-008, A-009, A-030, A-031, and A-032 as product hardening
    and scale work.
12. Fix A-057 and A-058 before launch copy claims developer category blocking,
    fine-grained category control, or reliable local quiet hours.
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
