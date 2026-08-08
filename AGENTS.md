# Agent Instructions and Current Code Audit

> **Authoritative health signal:** the live source of truth is `pnpm test` plus
> the `docker-build` CI job (which builds the images and boots the compiled API
> over TCP). This file is a narrative audit trail — re-run the quality gates
> after any change; do not treat its prose as the system state.

## Operating Rules for Agents

- Treat the current codebase as authoritative. Older docs, README status claims,
  roadmaps, and checklists may be stale.
- Before fixing an open item, re-inspect the relevant files — paths below are
  evidence pointers; line numbers and implementation details can drift.
- Separate audit fixes from unrelated edits; do not overwrite user work.
- Keep this file current: when an item is fixed, move it to the resolved index
  with the date and the verification command/manual test that proves it.
- Do not mark an item complete just because a narrow unit test passes.
- **Commit hygiene (hard rules):** never commit debug `console.log` printing
  tokens, JWT claims, session IDs, API bodies, or secrets (blocked pre-commit
  since 2026-07-13); the pre-commit hook is a deterministic eslint+prettier
  script (`.husky/pre-commit`, replaced lint-staged 2026-08-07 — lint-staged's
  stash machinery produced phantom commits); if a commit is made with hooks
  bypassed, run `pnpm lint` + `pnpm typecheck` manually before pushing.

## Current Status (snapshot 2026-08-07)

- **91 migrations.** The sandbox XTS economy wave (7 logical commits,
  `34270c1`…`f27beb2`) landed the previously-uncommitted worktree on top of
  `25da3e1`: sandbox module + schema/migrations, extension non-cash placement
  path, web panels, VSIX packaging + attention promotion, scenario harness,
  and the gate fixes below. Typecheck 17/17 and lint 11/11 green on the landed
  tree; sandbox 18/18, placement 12/12, scenario suites 30/30, VSIX bundle +
  isolated smoke, web panels 4/4, referral/ledger 39/39, vscode 138/139.
- Issues A-001…A-105 are resolved and gate-verified.
- **2026-08-07 third pass.** Running the e2e suites against the (then
  uncommitted) hardening wave surfaced three defects no gate covered: a totally
  broken email-queue failure path (A-103), GDPR erasure 500-ing under any
  concurrency (A-104), and a serialization-retry classifier blind to the error
  Prisma 7's pg adapter actually throws (A-105). Two were hidden by tests that
  fed the code a row shape the database never returns. See "Resolved 2026-08-07
  (third pass)" below.
- **2026-08-07 launch audit.** A from-scratch launch-readiness audit disproved
  the previous claim that only external items remained ("no source edit can
  close them"). It found four source-fixable blockers no gate covered — two of
  which (A-087, A-088) made a fresh production deployment non-functional — plus
  a live dependency advisory. All five are now fixed; see "Resolved 2026-08-07"
  below. Full analysis and phasing: `LAUNCH_PLAN.md`.
- **Gate coverage lesson:** every gate in this repo was green _while_ A-087
  shipped a user-visible failure in every build. Green gates prove the
  invariants they encode; they do not prove the product works. Prefer an
  assertion on rendered output over an assertion that a build succeeded.
- **Fresh gates after the 2026-08-07 fixes:** typecheck 17/17, lint 11/11,
  build 11/11, API unit **1316/1316** (127 files, +10), web 203, cli 123,
  vscode 142+1 skip, shared 77, e2e **114/114** (+28 content-gate tests),
  `audit-claims` 13/13, `scan-build-secrets` PASS, `audit-dependencies` clean,
  `pnpm audit --prod` clean.
- **2026-08-07 gate hardening (this session):**
  - Pre-commit hook: deterministic `eslint --fix` + `prettier --write` on
    staged files (no lint-staged, no stash); `lint-staged` dependency removed.
  - `validateWebEnv` now runs at web server boot when
    `WAITLAYER_REQUIRE_DEPLOY_ENV=1` (instrumentation `register()`); local/CI
    builds unaffected.
  - `test:integration` refuses the destructive per-file `prisma migrate reset`
    unless `CI=true` or `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`
    (`scripts/check-integration-consent.mjs`).
  - `.e2e/verify-key-alignment.mjs` compares SPKI fingerprints of root `.env`,
    `apps/api/.env`, and `.e2e/*.pem` before e2e runs (root+api+**.e2e all one
    keypair, 6 sources agree); `.e2e/*.pem` regenerated to the authoritative
    `.env` keypair.
- **2026-08-07 completion pass (this session, HEAD `22c59b7`):**
  - Opportunity-dedup matrix (`opportunity-dedup.spec.ts`, env kind `sandbox`)
    found two real defects, fixed by migrations `20260807000000_sandbox_xts_campaign_currency`
    (widens `chk_campaigns_currency_iso` to admit `XTS` on `campaigns` only —
    settlement surfaces stay XTS-excluded) and
    `20260807010000_sandbox_deposit_index_name` (renames the 63-byte-adjacent
    explicit index to the canonical name). 7/7; the cross-tenant spec
    (`b9fdb14`, 5/5) proves cross-user/cross-environment key isolation,
    concurrent faucet dedup, retention, and role gates with zero cash rows.
  - Attention ownership is now a time-bounded lease (ownerId + leasedUntil,
    60s default, refreshed on observation, stale reclaim in `claimLease()`,
    promotion skips disposed machines) so a crashed VS Code window can no
    longer deadlock the promotion queue (`ab72971`, 12/12).
  - Scenario runner hardening (`00ae5c1`): whole-POSIX-group teardown for
    detached fixtures (SIGTERM→SIGKILL), 2 MiB per-stream output caps, privacy
    canaries (PEM/JWT/Bearer/provider-webhook/GitHub/AWS patterns reported by
    name only) fail-fast the trace; 13/13 runner + 18/18 audit/report/catalog/
    coverage/repeat/triage tests.
  - VSIX chain proven end-to-end (bundle → package vsix → unzip → manifest has
    **zero** runtime deps → `verify-isolated-artifact` PASS). publish-vscode/
    publish-cli workflows gate the packaged artifact (apiUrl default check +
    isolated smoke) before upload, and release events now trigger publish.
  - CI/Docker inputs verified: gitleaks gets `GITHUB_TOKEN`; the
    `docker-build` CI job now boots the compiled API image and asserts
    controller routes resolve over TCP (login 400, /auth/me 401, /docs 200
    — non-404), scans the extracted web `.next` for signing secrets, and the
    compose web service carries build-time `JWT_PUBLIC_KEY`/`NEXT_PUBLIC_*`
    args + health checks.
  - Migrations: **91**, both dev (:5432) and test (:5433) drift-free
    (`migrate diff --exit-code` = no difference). Dev had a stale FAILED row
    for `20260807010000` (its rename hotfix already existed from a prior
    `db push`); healed with `migrate resolve --applied`.
  - Fresh gates: typecheck 17/17, lint 11/11, API unit 1306/1306 + all 21
    integration files, web 203, cli 123, shared 77, vscode 142+1 skip, build
    11/11, e2e **86/86 in 1.4m** (throttle overrides added to `.e2e/run-e2e.sh`,
    zero flakes), `audit-claims` 13/13, `scan-build-secrets` PASS (placeholder
    detection now requires an assignment context, after web-env.ts's allowlist
    literal made every bundle fail), `audit-dependencies` clean, `pnpm audit
--prod` clean.
- Worktree clean; commits landed this session: `b9fdb14` (cross-tenant spec),
  `eb9e6d8` (dedup matrix + 2 migrations), `ab72971` (attention lease),
  `00ae5c1` (scenario harness), `e8e476f` (scan fix + const), `22c59b7`
  (e2e throttle).

## Resolved 2026-08-07 — A-087…A-090 + A-091

Found by a from-scratch launch-readiness audit against `f5f69ec` and fixed the
same day. All four were source-fixable and none was covered by an existing
gate. Full context and phasing: `LAUNCH_PLAN.md`.

- **A-087 — `/legal/*` shipped "Content unavailable" in every build.** The three
  pages read `path.join(process.cwd(), 'docs', 'legal', '*.md')`; `next build`
  runs with cwd `apps/web` while the markdown sat at the **repo root**, so the
  read always threw ENOENT and a `try/catch` substituted a fallback string —
  frozen into the prerendered HTML of all three static routes, and linked from
  the footer of every page. Broken locally too, not just on deploy.
  **Fix:** content moved into the component tree — a shared
  `components/legal-document.tsx` plus three TSX pages, matching how `/terms`
  and `/privacy` already worked. The filesystem read and the silent fallback are
  gone; `docs/legal/` is now a pointer README. **Verified** by decoding the
  build artifact: all three `.next/server/app/legal/*.html` contain their real
  bodies and zero "Content unavailable" (previously the `<pre>` held exactly
  `'# GDPR Data Processing Agreement\n\nContent unavailable.'`).

- **A-088 — a fresh production database could not produce an admin.** No seed,
  script, endpoint, or migration created an `admin`/`super_admin`, and signup
  refuses privileged roles — so no campaign could be approved, no money switch
  flipped, no payout processed. The deployment booted inert, permanently.
  **Fix:** `scripts/bootstrap-admin.mjs` (`pnpm bootstrap:admin`) — constant-time
  `ADMIN_BOOTSTRAP_TOKEN` gate, one-shot (refuses once any admin exists, checked
  again inside the transaction against a concurrent run), shared
  `passwordValidationError` rules, bcrypt cost 12, creates User + AdminUser +
  an in-transaction `admin.bootstrap` audit row, never echoes the password, and
  prints the TOTP requirement that `AdminMfaStepUpGuard` enforces.
  `enforce-health-metrics.mjs` (which creates a **passwordless** CI admin) now
  hard-refuses under `NODE_ENV=production`. Deployment checklist gained a
  Step 0. **Verified** against the test DB: all four refusal paths, the happy
  path, the one-shot re-run guard, and the resulting row shape.

- **A-089 — the web app never disclosed the non-billable beta state.**
  `getWaitLaunchMode()` was consumed only by `extension-ad.trait.ts`, so a
  developer saw an empty earnings dashboard with no explanation while the
  marketing site discussed earning.
  **Fix:** launch mode is published on the public `GET /health` contract
  (fails soft to `unknown`, never to `earnings_enabled`); `LaunchModeBanner`
  renders on every `/developer/*` route from the layout so a new page cannot
  ship without the disclosure; the payout request form is gated on the same
  signal. 4 new controller specs cover the fail-closed behaviour.

- **A-090 — signed-up developers had no path to start.** The dashboard
  contained zero references to the extension, the CLI, install commands, or
  device registration.
  **Fix:** `GET /developer/devices` (a deliberately narrow select — never
  `eventSecret`, `publicKey`, or `fingerprintHash`; `take: 25`) plus a
  `DeveloperGetStarted` panel that self-hides once a client connects. 6 new
  specs, including one asserting the select shape so a future convenience edit
  cannot widen it into a signing-key leak. **Note:** the panel deliberately
  does _not_ link to the Marketplace/npm until the clients are actually
  published — flip `CLIENTS_PUBLISHED` in the component when they are.

- **A-091 — js-yaml advisory (GHSA-5p4m-2wfm-xmqj / CVE-2026-59870, high).**
  Surfaced mid-session as a newly published advisory, not by any code change:
  quadratic CPU on `!!omap` resolution in js-yaml <4.3.1, reaching production
  through `@nestjs/swagger` (plus dev paths via `@nestjs/cli`, `@vscode/vsce`).
  **Fix:** `'js-yaml@^4.0.0': 4.3.1` security floor in `pnpm-workspace.yaml`,
  scoped to ^4 so consumers are not forced onto 5.x. `audit-dependencies` and
  `pnpm audit --prod` clean; zero `js-yaml@4.3.0` left in the lockfile.

**The gate class that hid A-087.** Every gate here pointed inward — it proved
properties of the code to itself. None asserted that a user opening a page saw
the right thing, which is why a footer-linked legal document could be blank
since inception through 395 commits of green builds. `apps/web/e2e/public-content.spec.ts`
now asserts distinctive body text on 11 public routes, rejects degradation
markers (`Content unavailable`, `undefined`, `NaN`, `[object Object]`, error
strings), enforces a minimum body length so an empty shell cannot pass, and
checks the footer links resolve. **Prefer an assertion on rendered output over
an assertion that a build succeeded.**

## Resolved 2026-08-07 (second pass) — A-092…A-102, deployability

Found by actually building the images and booting the stack in production mode
rather than reasoning about it. **Nobody had ever done this**, and all three
defects below were fatal to a containerized deploy. Open item #4 ("Docker image
e2e needs a reachable npm registry") was a misdiagnosis: the registry is fine.

- **A-092 — `docker compose build` failed on a stock Docker install.**
  `docker-compose.yml` hardcoded `provenance: true` / `sbom: true` for both
  services; the default `docker` driver cannot produce attestations, so every
  build died with "Attestation is not supported for the docker driver".
  **Fix:** `provenance: ${DOCKER_ATTEST:-false}` / `sbom: ${DOCKER_ATTEST:-false}`
  — the documented path works out of the box, and CI/release sets
  `DOCKER_ATTEST=true` (with a buildx container driver or the containerd image
  store) to restore supply-chain attestations.

- **A-093 — `docker compose` on a deploy host builds the DEV image.**
  `docker-compose.override.yml` is committed and auto-loaded by Compose, and it
  overrides `target: build` for api and web, forces `NODE_ENV=development`,
  swaps the compiled entrypoint for `pnpm dev`, and enables
  `ALLOW_MOCK_GOOGLE`/`MOCK_GOOGLE_ENABLED`. Proven side-by-side:

  |                           | `docker compose build api` | `docker build --target api` |
  | ------------------------- | -------------------------- | --------------------------- |
  | Prisma CLI                | **MISSING**                | present                     |
  | full repo source in image | **PRESENT**                | absent                      |

  The production runbooks correctly pass `-f docs/ops/docker-compose.images.example.yml`,
  but `docs/ops/rollback.md` said bare `docker compose up -d --force-recreate`
  — i.e. mid-incident, the rollback runbook would have "recovered" production
  into a dev server with mock auth on. **Fix:** rollback.md corrected with an
  explicit `-f` and a warning; `deploy-preflight` hard-fails when the override
  is present.

- **A-095 — the production image could never run migrations.**
  `packages/db/prisma.config.ts` does `import { defineConfig } from 'prisma/config'`,
  but the api stage installs the Prisma CLI **globally** (to survive
  `pnpm install --prod`), and a global install is not on Node's module
  resolution chain. Loading the config failed with "Cannot find module
  'prisma/config'"; the CLI fell back to a config with no datasource and the
  container died on "The datasource.url property is required in your Prisma
  config file". Every containerized boot failed at the entrypoint — loudly
  (exit 1), but fatally.
  **Fix:** `ENV NODE_PATH=/usr/local/lib/node_modules` in the api stage, and
  the entrypoint runs `prisma migrate deploy` from `packages/db` (in a subshell
  so the cwd cannot leak into the `exec`). **Verified:** all 91 migrations
  applied from inside the container.
  Same root cause as the `migrate status` gate-command defect noted above —
  Prisma 7 takes the URL from `prisma.config.ts`, not the schema, and only
  discovers that config relative to the working directory.

- **A-094 — `pnpm deploy:preflight` (new capability, not a bug fix).**
  Nothing validated _an environment_; the gates validate the code. The
  preflight fails closed on: the A-093 override trap, the full
  `@waitlayer/config` production schema, `COOKIE_SECURE=false`, every mock-auth
  flag, test-only `THROTTLE_*` overrides, the reference attestation bridge,
  Postgres/Redis reachability, unfinished migrations, **no administrator**
  (A-088) or an administrator without TOTP, and it reports which money switches
  are live. Covered by `scripts/deploy-preflight.test.mjs` (10 tests, wired into
  `test:release-gates`) — a preflight that cannot fail manufactures confidence
  at exactly the wrong moment.

- **A-096 — a fresh production database could not boot the API.**
  `EnvironmentMarkerService.verify()` refuses to start a **production**
  deployment unless `environment_markers` row 1 exists and matches
  `WAITLAYER_ENVIRONMENT_KIND`/`WAITLAYER_ENVIRONMENT_ID`. Non-production
  auto-creates it; production deliberately does not, because auto-stamping
  would destroy the interlock (an API pointed at the wrong database would
  cheerfully claim it). That design is right — but **nothing created the row**:
  no seed, migration, script, or runbook. A fresh production database simply
  could not start the API.
  **Fix:** `scripts/bootstrap-environment-marker.mjs` — requires
  `--confirm-stamp`, refuses to overwrite a marker with different values (the
  exact wrong-database accident the interlock exists for), no-ops on a matching
  marker so redeploys are safe, and warns when stamping a database that already
  holds user rows.

- **A-097 — every login/signup/refresh returned HTTP 500 in production.**
  The worst defect found in this audit, and it was invisible to every gate.
  PEMs are documented to be stored as **single-line values with literal `\n`
  escapes** (Compose and `--env-file` cannot carry multi-line values). The
  verification path normalised those escapes (`jwt-keys.ts` `normalizePem`),
  but the RS256 **signing** path did not: `auth.module.ts` and
  `auth.service.ts` read `JWT_PRIVATE_KEY` raw and handed it to
  `jsonwebtoken`. A correctly-configured production API therefore booted
  cleanly, reported `GET /health` 200 with `database: connected`, served every
  public page — and then failed **all** authentication with
  `secretOrPrivateKey must be an asymmetric key when using RS256`.
  **Why nothing caught it:** `test-setup.ts` and `.e2e/run-e2e.sh` both inject
  real multi-line PEMs, so the escaped form — the only form a real deployment
  uses — was never exercised anywhere in 1316 tests.
  **Fix:** `normalizePem` exported and applied at both signing sites; new
  `jwt-signing-key.spec.ts` pins it, including a guard test asserting the raw
  escaped key genuinely fails to sign (so the suite cannot quietly stop testing
  the real thing) and an idempotence test so multi-line PEMs keep working.

**Rules this pass earns:**

1. _Build and boot the artifact you intend to ship._ A-087 hid because nothing
   rendered a page; A-092/093/095/096/097 hid because nothing ever built the
   production image, started it, and used it.
2. _Test the configuration format production actually uses._ A-097 survived
   1316 tests because every one of them supplied a friendlier input than any
   real deployment does. When a value has a canonical on-disk encoding, the
   encoding is part of the contract — test it, not just the parsed form.
3. _A green health check is not a working service._ The API reported healthy
   while 100% of authentication was failing. Health checks should exercise a
   representative path, not just liveness.

- **A-098 — no gate ever ran the API the way production runs it.** This is the
  structural hole A-097 lived in, and closing it matters more than the bug did.
  Every existing gate exercises a mode no deployment uses:
  - unit/integration: `NODE_ENV=test`, **multi-line** PEMs injected by
    `test-setup.ts`;
  - `.e2e/run-e2e.sh`: exports `NODE_ENV=development` for the API (the web is
    built for production, the API it talks to is not) — so all 114 e2e tests
    ran against a development API;
  - CI `docker-build`: boots the image in development (compose defaults
    `NODE_ENV=development`) and asserts only that routes _resolve_
    (login 400 / me 401 / docs 200) — never that a token can be **issued**.

  **Proven, not asserted.** The A-097 fix was reverted in a compiled build and
  both gates were run against that same binary:

  | check                         | broken build                                                               |
  | ----------------------------- | -------------------------------------------------------------------------- |
  | `/health`                     | **200** ✅ (reports `database: connected`)                                 |
  | `POST /auth/login` empty body | **400** ✅ (CI's existing assertion)                                       |
  | `GET /auth/me`                | **401** ✅ (CI's existing assertion)                                       |
  | `production-boot-smoke`       | **FAIL** — "login returned HTTP 500 — the API cannot sign tokens… (A-097)" |

  Every pre-existing check passed on a build where 100% of authentication was
  broken. **Fix:** `scripts/production-boot-smoke.mjs` +
  `scripts/production-boot-smoke.sh` (`pnpm smoke:production`) + a
  `production-boot-smoke` CI job. It runs `NODE_ENV=production` with PEMs in the
  single-line `\n`-escaped form (the runner **asserts** the PEM is escaped, so
  the blind spot cannot be silently restored), stamps a marker, bootstraps an
  admin, then asserts a token is **issued**, **verifies against the configured
  public key**, carries `RS256` + a `kid` + `aud: [audience, 'access']`, and is
  **accepted** by a protected route — plus Swagger closed, mock-Google closed,
  privileged-role signup refused, MFA step-up enforced, switches fail-closed.
  19 assertions, green on the fixed build.

  **Two harness defects were found by running the gate itself** (a gate that
  false-fails is worse than none — it trains people to ignore it):
  1. Running the smoke straight after the e2e suite produced three 429s that
     looked like broken routes. Throttle/brute-force counters live in Redis and
     were shared with dev/e2e. Fixed: the runner takes its own Redis database
     index (`SMOKE_REDIS_DB`, default 9), and the smoke retries 429 with
     backoff then reports it **as a throttle**, never as a route defect.
  2. The runner did not free its port first, so a leftover API from a previous
     run answered the health check with the _old_ key pair while the smoke
     verified against the _new_ one — a "key pair mismatch" that was an
     artefact of the harness, not the build. The assertion was right; the
     runner was not hermetic. Fixed: kill the port before boot, refuse to test
     a process it did not start, and kill the port again on exit.
     Now deterministic across back-to-back runs and immediately after e2e.

- **A-099 / A-100 — 2FA enrolment was impossible, so the platform was inert for
  two more independent reasons.** Found by asking "can the admin `bootstrap-admin`
  creates actually do step 6 of the cold-start?" — the answer was no.
  - **A-099:** the only TOTP enrolment UI lived in `/developer/settings`, which
    is wrapped in `<ProtectedRoute allowedRoles={['developer']}>`. An admin
    navigating there got "Access denied — Your account role (super_admin) does
    not have access to this page." **Fix:** new `/admin/security` page + shared
    `components/two-factor-enrolment.tsx`, added to the admin nav.
  - **A-100 (worse — affected every role):** the UI called
    `POST /auth/2fa/setup` with **no body**, but the endpoint requires a
    re-authentication proof (`auth-totp.trait.ts:66` — "Reauthentication is
    required before setting up 2FA") and returns **401** without one. Proven
    against a live production API: `setup2fa()` → **401**;
    `setup2fa({currentPassword})` → **200 with a secret**. So _nobody_ — no
    developer, no admin — could ever enable 2FA through the product.
  - **Combined impact:** admins could never satisfy `AdminMfaStepUpGuard`, so
    no campaign approval, no money switch, no payout processing — ever. And
    because `PAYOUT_REQUIRE_2FA=true` is _required_ in production, **no
    developer could ever request a payout**. Both surfaces now collect the
    password and pass it.
  - **Verified end-to-end** against a production-mode API: admin write **403**
    before 2FA → `/auth/2fa/setup` **200** → `/auth/2fa/enable` **200** →
    re-login with TOTP **200** → the same admin write **201**.
  - **Gate:** the production smoke now asserts both halves — that setup
    _requires_ a re-auth proof (the security control must not become permissive)
    **and** that it _succeeds_ with one (enrolment must remain possible). 21/21.

- **A-101 — the browser suite now runs against a PRODUCTION-mode API**
  (`pnpm e2e:production`, `.e2e/run-e2e-production.sh`). `.e2e/run-e2e.sh`
  builds the web for production but exports `NODE_ENV=development` for the API,
  so all 114 browser tests exercised a development API — the same split that
  hid A-097. The new runner boots the API exactly as a deployment does
  (production env kind, escaped PEMs, stamped marker, full config schema, mock
  auth off, MFA step-up live) and **rebuilds the web against that run's public
  key**, because the middleware and client bundle inline `JWT_PUBLIC_KEY` and
  `NEXT_PUBLIC_*` at **build** time (A-083) — a runtime-only value would leave
  middleware verifying with the wrong key. Isolated ports (4108/3100), its own
  Redis database index, hermetic port cleanup.
  **Result: 114/114 green against production**, including the authenticated
  developer and advertiser journeys through the real BFF (cookie issuance,
  identity-header HMAC signing, middleware JWT verification). No test changes
  were needed — the suite already avoids the dev-only mock-Google button.

- **A-102 — the entire payout path and both GDPR erasure routes were
  unreachable from the UI.** The most consequential finding after A-097, and
  found the same way: by driving a real user journey against a production API
  instead of reading code.
  Seven routes are guarded by `ActionStepUpGuard`, which **unconditionally**
  rejects any request lacking an `x-step-up-token` header:
  `payout:method` (register/remove a payout account), `payout:request`,
  `api_key:create`, `account:delete` (**developer** and **advertiser** — GDPR
  Art. 17), and `2fa:disable`.
  **Nothing ever sent that header.** Worse, `/auth/step-up` was not on the BFF
  proxy allowlist, so the web could not even _request_ a token — and the proxy
  builds an allowlisted header set, so the header would have been dropped even
  if a client had sent one. Three independent breaks in the same chain.
  **Consequence:** a developer could never register a payout account or request
  a payout, nobody could create an API key, and **neither role could delete
  their account** — a standing GDPR Article 17 exposure.
  **Proven against a live production API** (the API itself is correct; the
  defect was entirely client-side):

  | step                                       | result                                       |
  | ------------------------------------------ | -------------------------------------------- |
  | `POST /payout/method` with no header       | **403** "Step-up authentication is required" |
  | enable 2FA, `POST /auth/step-up`           | **200**, token issued                        |
  | same `POST /payout/method` **with** header | **201** ✅                                   |

  **Fix:** `/auth/step-up` added to the proxy allowlist; the proxy forwards
  `x-step-up-token` (safe — the API verifies signature, audience, subject
  binding, action scope and 5-minute expiry); an axios interceptor detects the
  specific refusal, prompts via `StepUpProvider` (mounted in the developer,
  advertiser and admin shells), exchanges the TOTP code for an action-scoped
  token, and retries once. Tokens are deliberately **not** cached — caching one
  would defeat the "prove MFA at the moment of the sensitive action" property.
  **Gate:** `lib/api/step-up.spec.ts` (17 tests) pins the route→action map, so a
  moved route that loses its mapping fails the suite instead of silently
  becoming unreachable again. It also asserts the interceptor does **not**
  swallow the _admin_ MFA refusal, which has a different message and a
  different remedy.

**Cold-start deploy verified end-to-end (2026-08-07).** The full first-deploy
sequence was run against an **empty database** using the shipped
`--target api` image with nothing mounted:
`migrate deploy` (91 applied) → `bootstrap:env-marker --confirm-stamp` →
`bootstrap:admin` → boot → `GET /health` 200
(`environmentKind: production`, `waitLaunchMode: paused`, database + redis
connected) → **`POST /auth/login` 200 issuing a `super_admin` token** → admin
reads 200 → admin write correctly **403 "Recent two-factor authentication is
required"** → all five money switches `enabled: false`.

That run also exposed an **ordering trap**: `environment_markers`, `users`, and
`admin_users` are created by the migrations, so both bootstrap scripts fail on a
truly empty database. The order is `migrate deploy` → marker → admin, now
documented as a cold-start table at the top of
`docs/ops/deployment-checklist.md`, and both scripts detect the missing-schema
case (P2021) and say "run migrations first" instead of surfacing a bare
Prisma "table does not exist".

**Measured, deferred, and RESOLVED 2026-08-08 on the second attempt — see A-112.**
The first attempt broke the container; the fix was a structural one. Read A-112
before touching image ownership.

## Resolved 2026-08-07 (third pass) — A-103…A-105

Found by running the e2e suites after the uncommitted hardening wave, and by
following each failure to its root cause instead of relaxing the assertion. All
three were invisible to every existing gate; two were hidden by tests that fed
the code a shape the database never produces.

- **A-103 — the transactional email queue was entirely broken on the failure
  path.** `EmailQueueCron` leases rows with `SELECT * FROM "email_queue"`, but
  `retryCount` is `@map("retry_count")`, so the raw row carried `retry_count`
  and `job.retryCount` was **`undefined`** at runtime. `EmailQueueRow` still
  declared it `number` — a raw query's type parameter is an **unchecked
  assertion**, so `tsc` was satisfied. The fallout compounded:
  `job.retryCount + 1` → `NaN`; `retryCount >= MAX_RETRIES` never true (rows
  retried forever); `2 ** NaN` → an **Invalid Date** for `nextRetryAt`; and the
  failure-path `update()` then threw, aborting the **whole batch transaction**.
  One undeliverable message stopped the entire queue — password-reset,
  email-verification and payout-frozen alerts included. Delivery itself worked,
  which is why nothing noticed: only the failure path was broken.
  **Why nothing caught it:** every unit test mocks `$queryRaw` and returns a
  **camelCase** row the database never returns, so the suite validated a shape
  production never sees.
  **Fix:** an explicit aliased projection (`"retry_count" AS "retryCount"`),
  never `SELECT *`. **Gate:** `src/integration/email-queue-cron.spec.ts` runs
  the cron against the **real** database (3 tests: increments the mapped column,
  parks an exhausted row, and survives a poison row without aborting the batch),
  plus a unit assertion pinning the projection. **Proven** by reverting the fix:
  all three integration tests and the projection assertion fail; with the fix,
  12/12 green and deterministic back-to-back.

- **A-104 — GDPR Article 17 erasure failed with HTTP 500 under any concurrency.**
  `eraseAccountIdentity` runs SERIALIZABLE and scrubbed audit rows with a single
  `OR: [{ actorId: { in } }, { targetId: { in } }]`. Postgres cannot index a
  disjunction across two columns, so it **sequentially scanned `audit_logs`** —
  and a seq scan inside a SERIALIZABLE transaction takes a **relation-level
  predicate lock**, which conflicts with the audit row that nearly _every_
  request inserts. The transaction had **no retry at all**, so deletion returned
  a bare 500 whenever the system was busy, and the failure rate grows with
  `audit_logs` forever. `targetId` was only ever a trailing column
  (`targetType, targetId`), so it could not seek either.
  **Why nothing caught it:** the e2e fixture used to delete accounts
  best-effort inside a `try/catch`. The uncommitted wave removed that swallow —
  which is the only reason this surfaced, and a good argument for never letting
  cleanup hide failures.
  **Fix:** three parts — (1) migration `20260807040000_audit_logs_target_id_index`
  adds `@@index([targetId])` (plan cost 137 → 19, Bitmap Index Scan); (2) the
  `OR` is split into two separately indexed statements; (3) a bounded
  serialization retry (8 attempts, exponential backoff with full jitter, capped
  at 2s) — SSI aborts are retryable by design and the transaction is idempotent
  (it re-reads the subject inside the advisory lock and returns early once
  `status === 'deleted'`). **Verified:** browser e2e went 15 failures → 3 → 2 →
  **0**, and production-mode e2e 4 → 1 → **0**.

- **A-105 — the shared serialization-retry classifier missed the error Prisma 7
  actually throws.** `isSerializationError` keyed entirely off `P2034`/`P2038`/
  `P2010`. Inside an interactive `$transaction`, `@prisma/adapter-pg` converts
  SQLSTATE `40001` into a raw `DriverAdapterError`
  (`cause.kind = 'TransactionWriteConflict'`, `message` the bare kind string)
  and throws it **with no `code` at all**. Every retry loop in the repo
  therefore let a genuine serialization abort escape as a 500 — including
  `auction.service.ts`, which is on the money path. `sandbox.service.ts` carried
  its own even narrower `instanceof PrismaClientKnownRequestError && code ===
'P2034'` copy with the same hole.
  **Fix:** `isSerializationError` recognises the raw `DriverAdapterError`
  envelope; the sandbox duplicate now delegates to it. **Gate:**
  `src/common/utils/errors.spec.ts` (7 tests) pins the real adapter shape,
  asserts it carries no `code` (so the test cannot stop testing the real
  hazard), and asserts deterministic failures — unique-constraint, not-found,
  `TableDoesNotExist`, a different `DriverAdapterError` kind — are **not**
  classified retryable.

**Also this pass:** a cross-boundary contract had no guard — the API generates
2FA backup codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` while the browser
(`two-factor-input.ts`) only forwards `[A-HJ-NP-Z2-9]{4}-…`; a drift on either
side would make the client silently drop valid recovery codes with no server
trace. `src/auth/backup-code-format.spec.ts` now generates 1000+ codes and
asserts they match the browser's exact pattern (proven by mutating the
alphabet). `GET /payout/providers` also gained a real-HTTP contract test — the
payouts UI gates registration entirely on it and fails **closed**, so drift
would delete the feature silently rather than erroring.

**Rule this pass earns:** _a raw query's type parameter is a lie until a test
runs it against the database._ `SELECT *` plus `@map` plus an unchecked generic
produced `undefined` where the types promised a number, and every mock in the
suite agreed with the types instead of the database.

**Fresh gates after the third pass (all re-run green on this tree):** typecheck
17/17, lint 11/11, build 11/11, API **1618/1618 across 155 files** (unit +
all 22 integration files, `--no-file-parallelism`), web 253, cli 123, vscode
142 + 1 opt-in skip, shared 77, config 13, browser e2e **114/114**
(`.e2e/run-e2e.sh`), production-mode browser e2e **116/116**
(`pnpm e2e:production`, includes the sensitive developer journey on both
viewports), `test:release-gates` exit 0, `audit-claims` 13/13,
`scan-build-secrets` PASS, `audit-dependencies` clean, `check-licenses` clean,
`pnpm audit --prod` clean. Migrations **94**, dev (:5432) and test (:5433) both
applied and `migrate diff --exit-code` drift-free.

**Third harness defect found the same way (`pnpm smoke:production`, 21/21).**
The smoke defaults to the SHARED `waitlayer_test` database, and the integration
suites deliberately enable the money switches in their `beforeAll`. Running the
smoke straight after `vitest run src/integration` therefore reported
"money-switches unexpectedly ENABLED: payouts.requests" — a **deployment-blocking
verdict on a perfectly good build**, five minutes into the run. The assertion is
right and was left untouched; the runner now probes the switches BEFORE booting
(`scripts/read-enabled-money-switches.mjs`) and exits 2 naming the leftover
integration state and the `SMOKE_DATABASE_URL` escape hatch. Verified in both
directions: it fires on a contaminated database and stays silent on a clean one.
Same class as the Redis-index and port-hermeticity fixes — _a gate that
false-fails trains people to ignore it._

**The vscode live smoke now actually runs.**
`apps/vscode-extension/test/api-client.live.spec.ts` is gated on
`RUN_LIVE_TESTS=true`, which was set **nowhere** — no CI job, no script — so it
had never executed once. It was not misleading (its header says it is opt-in)
but it was not coverage either: the extension's only live ApiClient path was
entirely unverified. The e2e job and `.e2e/run-e2e.sh` already have an API on
:4002, which is the spec's default target, so both now run it there. It signs up
a developer over real HTTP and asserts the balance deserializes to a **bigint**
— the repo's money invariant, which the mocked unit tests cannot show. Verified
live: passes against the running API, and fails with `ECONNREFUSED` when the API
is down (so it cannot silently become a no-op again).

## Verified green 2026-08-08 — 12/12, with the gates that never ran

`integration/agent-beta`: **all 12 CI jobs green**, repeatedly — `15ca0de`,
`d3a6af1`, `f22544a`, `bebe6e2`. For the first time that includes gates which had
never actually executed:

- **both runtime image scans** — `Total: 0 (HIGH: 0, CRITICAL: 0)` for the API
  and the web image. They had always been _skipped_, because `docker-build`
  failed earlier in the job. The 11 findings that prompted the npm removal and
  the 2 that prompted the pnpm removal are gone.
- **full-history secret scanning** — every previous green run scanned only the
  triggering event's commits (A-108).
- **the container's own healthcheck**, asserted directly rather than inferred
  from a host-side probe — the blind spot that hid A-106.

CI can now be run on demand (`gh workflow run ci.yml --ref <branch>`), so a
release candidate is verifiable _before_ it lands on `main` rather than after.

Sequence, for anyone reconstructing this: A-106 → A-109 → A-107 → A-108/A-110 →
A-111 → A-112 (attempted, reverted). Each was found by a gate that the previous
fix unblocked — a red job is a ceiling on what you know, not a complete list.

## Resolved 2026-08-08 (sixth pass) — A-106, the image that could not boot offline

**A-106 — the runtime image downloaded a 22 MB Prisma binary on every container
start.** `@prisma/engines` does not ship the `schema-engine-<platform>` binary in
its npm tarball (`files: ["dist","download","scripts"]`); its `postinstall`
fetches it. The api runtime stage installs with `--ignore-scripts`, so the
binary was simply absent from the image, and Prisma fetched it lazily on first
use — which in a container is `prisma migrate deploy` in the entrypoint.

Consequences, all measured rather than reasoned about:

- Cold start went from **10.5s** (`dbeec08`, container Started → Healthy) to
  **46s** (`b3f95fb`, same measurement), and on the next step of the same run
  the container never became healthy at all: **272s of failing probes**, then
  `dependency failed to start: container waitlayer-api-1 is unhealthy`.
- **An image built this way cannot start on a host with no egress to Prisma's
  CDN** — an ordinary production posture. That is strictly worse than the HIGH
  CVE the change was fixing.

Proven locally, not inferred: hiding the local `schema-engine-debian-openssl-3.0.x`
and running `prisma migrate status` silently re-downloaded all 22 MB before doing
anything. `scripts/ensure-prisma-engines.mjs` now fetches it once at build time
and **fails the build** if it is still missing; both branches were exercised
locally. A contract test asserts the fetch exists, runs _after_ the production
install, and still exits non-zero on failure — all three mutations were caught.

**How this hid, and the lesson.** The api boot step proved the API serves 200 on
`/health/ready` **through the published port**. The container's own healthcheck
is a different code path — `wget` inside the container — and _nothing in that
step ever evaluated it_. So the step passed while the very probe the documented
production cold start (`docker compose up -d --wait`) depends on was failing.
The boot step now asserts the in-container healthcheck directly, where the API
is already known-good and the failure is unambiguous. `docker-entrypoint.sh` also
prints timestamped phase markers (waiting for postgres / applying migrations /
starting application), because a slow cold start previously produced a silent
log and `health: starting` with nothing to diagnose from.

Two smaller pipeline fixes came with it: `up -d web` fails on its
`depends_on: service_healthy` **before** the readiness loop, so the existing
diagnostics never fired and the only output was the one-line "is unhealthy" —
it now dumps the health-probe history and api logs at the point of failure.

**A-111 — new HIGH advisory in a production dependency: `nanoid` <3.3.17.**
Surfaced by the `pnpm audit --prod` gate, not by any code change (advisory
databases move under you). A custom generator can loop indefinitely when `size`
is zero. It reaches the tree only through build tooling
(`@sentry/nextjs -> webpack -> terser-webpack-plugin -> postcss -> nanoid`, and
`next -> postcss -> nanoid`), but `@sentry/nextjs` is a production dependency of
`apps/web`, so the gate is right to block. Fixed with a security floor scoped to
the `^3` range, matching the existing `brace-expansion`/`js-yaml` style — the
tree resolves to a single `nanoid` today, and a bare override would also rewrite
any future 5.x consumer. Verified locally: `nanoid@3.3.17`,
`pnpm audit --prod --audit-level moderate` reports no known vulnerabilities, and
`pnpm install --frozen-lockfile` (what CI runs) passes.

**A-112 — the 1.18 GB ownership layer, fixed on the second attempt.**
`RUN chown -R node:node /app` was a measured **1.18 GB** layer on a 4.75 GB
image, because a recursive chown re-touches the inode of every file already
copied and overlayfs then copies all of them up again.

**Correction to the earlier note:** it was also described as dominating build
time (~15–20 min). That was a local-host observation and CI does not reproduce
it — `docker-build` took 954s with the chown and 971s after removing it, i.e.
unchanged within noise, because the assemble→runtime hand-off copies the tree
once where the chown used to rewrite it once. **Image size is the only place the
win appears**, so `docker-build` now reports both images' sizes and largest
layers, informational rather than gating — that number had never been measured
in CI and there was no baseline to regress against.

**A-113 — and that measurement immediately found a bigger one.** With the
ownership layer gone, the largest remaining layer was **1.73 GB from `base`**:
a full `pnpm install --frozen-lockfile` of every dev dependency. Both runtime
stages were `FROM base`, and layers are additive — inheriting it and then
overwriting `/app` leaves the 1.73 GB in the shipped image permanently. The
runtime stages need none of it: everything they run arrives in the single
`COPY --from=assemble_*`. They are now `FROM node:22-alpine`. The only thing
lost with `base` is `ENV CI=true` — and that turned out to matter. Dropping it
produced a silent hang: migrations applied, the entrypoint printed
`starting application`, and then the Node process sat with nothing listening
(health probe `ExitCode 4`, connection refused, FailingStreak 10). No source
file reads `process.env.CI`, which is why it looked safe, but LIBRARIES branch
on it and some prompt or block when it is unset. Every previously-shipped image
inherited `CI=true` from `base`, so removing it was an uncontrolled behaviour
change rather than a cleanup. It is set explicitly in both runtime stages now,
which keeps A-113 purely a size change. As a bonus, pnpm is no longer present in the runtime
base at all, so the removal that fixed A-109 is now belt-and-braces rather than
load-bearing.

**Measured end to end (CI `docker-build`, which now reports it):**

| stage                                               | API image   |
| --------------------------------------------------- | ----------- |
| before                                              | **4.75 GB** |
| after A-112 (assemble + one ownership-correct copy) | **2.9 GB**  |
| after A-113 (runtime rebased off `base`)            | **1.3 GB**  |

Web ends at **1.3 GB**. What remains is 1.13 GB of application tree, 151 MB of
`node:22-alpine` and ~9 MB of tooling — the app itself now dominates and nothing
is duplicated. CI build time was unchanged throughout; size was the whole win,
which is why the report was added rather than the saving assumed.

The contract guard was rekeyed from the stage's PARENT (`base AS api`) to its
NAME. Tied to the parent it would have silently matched nothing after this
change and passed vacuously — the same failure mode as a test that stops
asserting anything.

**Attempt 1 (reverted).** Put `--chown=node:node` on each of the 20 runtime
`COPY` lines and delete the recursive chown. It broke the API container:
migrations still applied (2s), the entrypoint still printed
`starting application` — and then the Node process sat **alive and completely
silent for 176s** and never served. Not a timing budget; not a crash loop
(`Up 2 minutes (health: starting)`, not `Restarting`); no output at all. Cause:
the steps that run AFTER the copies — the `--prod` install, the engine fetch,
`prisma generate` — leave root-owned files that `COPY --chown` cannot reach and
the recursive chown used to sweep up.

**Attempt 2 (kept).** Stop fixing ownership up afterwards and remove the
"afterwards" instead. Each image is now built in two stages: `assemble_api` /
`assemble_web` create every file as root, with the pnpm store inherited from
`base` so the `--prod` install stays offline; the runtime stage then takes the
finished tree in **one** ownership-correct copy —
`COPY --from=assemble_api --chown=node:node /app /app`. Ownership is set as the
files land, in a single layer, and nothing is created after that point. npm and
pnpm are still removed in the runtime stage, which is where they would otherwise
ship.

The guard encodes the actual invariant rather than the mechanism: both runtime
stages must drop to `USER node`, carry no `RUN chown -R`, and — the lesson from
attempt 1 — run **no file-creating step after the ownership-setting COPY**.
Mutation-tested four ways, including reintroducing the recursive chown and
moving `prisma generate` back after the hand-off, which reproduces attempt 1's
failure and is caught.

**A-109 — the last 2 image CVEs came from pnpm, which the runtime never uses.**
The image scans ran for the first time ever on 2026-08-08 (they had always been
skipped, because `docker-build` failed earlier in the job). Result for the API
image: **0 findings in Alpine OS packages** — the npm removal cleared all 11
previous findings — and **2 node-pkg findings (1 CRITICAL, 1 HIGH) in `tar`
7.5.16**. That version appears **nowhere in `pnpm-lock.yaml`**, so no override
could reach it: it is pnpm's own bundled copy at
`/usr/local/lib/node_modules/pnpm/dist/node_modules/tar`. Confirmed by
installing pnpm 11.9.0 into a plain `node:22-alpine` and reading the version —
7.5.16, an exact match, so the causal link is measured rather than assumed.
pnpm is build-time only (it performs the `--prod` install; both runtime CMDs run
`node` directly), so it is removed from both runtime stages alongside npm. That
fixes both findings at the source instead of suppressing them. The contract
guard now covers both tools, and was mutation-tested to confirm the npm
assertion cannot be satisfied by the pnpm line.

**A-107 — the Stripe webhook's authenticity boundary was untested.**
`stripe-webhook.controller.spec.ts` had 14 tests and is thorough on money
reconciliation, but every one drives `processEvent`/the handlers directly, so
`verifyWebhookSignature` was a mock that gated nothing. Measured, not asserted:
with the signature check removed from `handleWebhook`, **18 of 19 tests still
passed** — the suite was blind to the removal of the entire authenticity
boundary on a money endpoint. Five tests now go through the HTTP entry point and
assert both properties that matter — the request is refused _and_ nothing is
recorded or moved (no `webhookEvent` row, no ledger entry): missing signature
header, forged signature, raw-body substitution, Stripe unconfigured, and
missing raw body. Both removals are now caught.

**A-108 — secret scanning has never covered git history.** `gitleaks-action`
picks its scope from the event: on `push`/`pull_request` it scans only that
event's commits, so every green run has been incremental. The first full-history
scan (triggered by the new `workflow_dispatch`) reported **23 findings**. All 23
were verified benign at their flagged commits — `generated-32-plus-character-secret`
and `ci-test-jwt-secret-at-least-32-chars-long-ok` placeholders, the
`Aa1Bb2Cc3Dd4…` dev-only compose values that file already documents as dev-only,
`__fixtures__/test-keys*.ts`, and a sample key in `.env.example`. **No real
secret, nothing to rotate.** The gap is the scope, not the findings: a secret
committed before the current push would never be caught.

`.gitleaksignore` now carries those 23 as **exact `commit:path:rule:line`
fingerprints**, with the evidence for each group recorded in the file itself.
This is a baseline, not a suppression rule — it pins 23 specific historical
findings and nothing else, so a real secret committed to any of the same files
(spec files included) still fails. A path glob such as `*.spec.ts` would blind
the scanner to exactly the case it exists to catch, so a contract test asserts
every entry is a full fingerprint with no glob characters, under a hard count
cap that makes growing the baseline a reviewable act. Net effect: full-history
scanning is possible for the first time. Mutation-tested — appending `*.spec.ts`
fails the guard.

That took the scan from 23 findings to 1, and the last one was the baseline
itself: `.gitleaksignore` documents why each entry is benign, and doing that
honestly means quoting the values being baselined, so the quoted
`'test-secret-at-least-32-characters-long-0123456789'` in a COMMENT matched the
same heuristic. Baselining that finding would not work — a fingerprint embeds
the commit SHA, so it goes stale the next time anyone edits the file. A
`.gitleaks.toml` therefore excludes that one path, and `useDefault = true` keeps
every upstream rule active. A contract test asserts both: without `useDefault` a
config REPLACES the default ruleset, so adding this file to exclude one path
would have silently turned the scanner into a no-op that still reports green.
Mutation-tested against dropping `useDefault` and against widening the allowlist
to `*.spec.ts`.

**A-110 — `/health/migrations` was unauthenticated, unthrottled, and published
schema names.** A route sweep of all 159 API handlers found 141 guarded and 18
unguarded; 17 are correctly public (auth entry points, JWKS, probes, the
signature-verified Stripe webhook, anonymous consent, throttled feedback). The
18th was this one. `@SkipThrottle()` is applied controller-wide — correct for
`/health` and `/health/ready`, since a 429 on a liveness probe gets the
container killed — which left this ops endpoint doing an `fs.readdir` of the
migrations directory plus a database query on **every unauthenticated request,
with no limit of any kind**, and returning migration NAMES to anyone who asked.
Its only consumer is the post-deploy canary in `staging.yml`, which reads just
`upToDate` and `pendingCount`. It now re-enables the throttler for that route
alone (30/min) and returns only those two fields. Three mutations caught:
republishing the names, restoring the blanket skip, and throttling the readiness
probe. Note the metadata keys are name-suffixed scalars
(`THROTTLER:SKIPdefault`), read from the decorator source — the obvious guess
reads back `undefined` and would have made the assertions vacuous.

## Resolved 2026-08-07 (fifth pass) — CI green, plus two self-audited gaps

**CI on `main` is green for the first time: 12/12 jobs at `dbeec08`**, including
`docker-build` with both container-boot steps actually executing (API and web
each built, booted, and served over TCP). Reaching that took five layered
fixes, each hidden behind the previous one — see the fourth-pass section.

Two further gaps were then found by reviewing the pipeline rather than by any
failure:

- **Ephemeral CI private keys were printed in plaintext in Actions logs.**
  GitHub does not auto-mask values written to `GITHUB_ENV` and echoes every
  step's `env:` block, so the per-run RS256 key appeared across the test, e2e,
  docker-build and production-boot-smoke jobs. Disposable, but it violates this
  repo's own no-secrets-in-logs rule. All four generation blocks now
  `::add-mask::` before writing; multi-line secrets are masked line by line
  (the only form GitHub honours), and only the base64 body — masking the
  `-----BEGIN…` delimiters would redact unrelated log lines. Public keys stay
  unmasked so key-alignment failures remain readable. Verified locally: 26 mask
  directives from a real key, no heredoc whitespace corruption, every masked
  line matching a key line exactly, and the escaped form byte-identical so the
  A-097 assertion is unaffected.

- **Nothing scanned the runtime images.** `trivy fs` covers the source tree,
  which cannot see the base image, OS packages, or anything
  `pnpm install --prod` pulled into the runtime layer. Both images are now
  scanned as release gates in `docker-build`, where they already exist
  (`down -v` removes containers, not images), with `ignore-unfixed: true` to
  match the existing filesystem-scan policy. **These two scans have never
  executed** — Trivy's DB download is blocked in this environment. If the first
  run is red the findings are real and have fixes available by definition; do
  not reach for the severity threshold.

**Double spending is now proven, not just structurally prevented.**
`payout_allocations` carries `@@unique([earningsEntryId])`, so Postgres makes it
impossible for one earnings entry to fund two payouts — but nothing checked
whether the LOSER of that race gets a clean refusal or a raw constraint
violation surfacing as a 500 (which reads as a platform fault and invites a
retry). `payout-double-execution.spec.ts` now races two requests with DISTINCT
idempotency keys against one entry — genuinely different from
`payout-idempotency-race`, which races the same key and is replay safety. Result:
exactly one 201, a sub-500 refusal, one allocation row, one payout request.

**Gap sweeps that came back clean** (recorded so they are not re-run blindly):
every one of the 13 cron classes is registered in a module (the ad-opportunity
expiry cron was the only orphan, restored in the fourth pass); no composite
index has columns unreferenced in TypeScript; no `package.json` script points at
a missing file; every `|| true` remaining in CI is cleanup, diagnostics, or a
documented fallback — none masks an assertion; all 59 distinct API paths the web
calls are covered by the BFF proxy allowlist (`/api/platform-health` is a local
Next route handler, not proxied); and `runtime-config-redis-propagation` really
does run in CI, which sets `REDIS_URL`.

## Resolved 2026-08-07 (fourth pass) — the CI-only defect class

The first pass of this session verified everything locally and reported green.
CI on that exact commit was **red in 6 of 12 jobs**. Everything below was
invisible locally for the same reason: a previous `pnpm build` had left build
output in the working tree, so the local runs never exercised a clean checkout.

**One defect explained four of the six.** `pnpm --filter <pkg> build` does NOT
build workspace dependencies, and `@waitlayer/db`'s package `main` is
`./dist/index.js` — produced by `tsc`, not by `prisma generate`. Every job that
RAN the compiled app only ran `generate`. The symptoms looked unrelated:

| job                     | symptom                                               |
| ----------------------- | ----------------------------------------------------- |
| `e2e`                   | "API not ready" — never opened :4002                  |
| `production-boot-smoke` | died stamping the environment marker                  |
| `e2e-production`        | marker read failed, `\|\| true` swallowed it, harness |
|                         | reported a misleading "marker mismatch"               |
| `test`                  | 11 scenario runners import `apps/api/dist/...`        |

Fixed with the dependency-aware `"pkg..."` filter the CLI/VSIX jobs already used
correctly, plus ORDERING: both production harnesses read the environment marker
~80 lines before their build step, so the build had to move earlier, not just
gain a suffix. `backup-restore` passed throughout precisely because it is the
one job that already ran `pnpm --filter @waitlayer/db build`.

**Then fixing those revealed three more that had been shadowed.** This is the
"one failure hides five" property in action — worth remembering that a red job
is a _ceiling_ on what you know, not a complete list.

- **`security` (Trivy HIGH).** `AsymmetricPrivateKey` at
  `packages/config/src/index.spec.ts:17`. A deliberately fake, truncated key —
  but Trivy's rule matches a complete PEM on one physical line, which is what a
  single-line JS string with `\n` escapes is. (The real multi-line key in
  `apps/api/src/auth/__fixtures__` spans lines and never matched — the opposite
  of what you would guess.) Fixed by assembling the PEM at runtime, so no header
  literal exists. No `.trivyignore`, no severity change. Verified both
  directions with Trivy 0.55.2: the fixed file is clean, and a file containing
  the original literal still reports HIGH.
- **`docker-build`.** Compose rejected `provenance`/`sbom` under `build:` at
  SCHEMA level and validates the whole file, so `build web` failed on `api`'s
  keys. A-092 had made them env-driven, which fixed the DRIVER problem but not
  this one. Removed; `DOCKER_ATTEST` went with them because it drove nothing —
  and a release gate had been asserting that switch as proof the pipeline
  "requests attestations", certifying a capability that did not exist. That
  assertion now checks cosign keyless signing, which is real. Removing the keys
  also un-breaks the staging release build, which issues the same command and
  had simply never run.
  Then the next-layer bug appeared: `config --images | grep -- '-web$'` can
  never match, because the name always carries a tag (`waitlayer-web:local`).
  Now reads `services.web.image` from `config --format json`.
- **`e2e` (after the API booted).** 113 passed, 1 "flaky", and
  `failOnFlakyTests` correctly failed the run. Not flakiness: `loginAs` hung to
  its 45s navigation timeout partway through. The suite authenticates from ONE
  IP against a 10/min production auth throttle. Both `.e2e` runners raise
  test-only ceilings — which is exactly why `e2e-production` passed while this
  job failed on the same specs. The CI job now sets the same ceilings.
- **`test` coverage floors** (`wise` 72.97% < 73%, `paypal-payouts` 62.26% <
  63%). This gate had never executed. Floors were NOT lowered; seven branch
  tests were added for untested fail-closed behaviour — production refusing to
  return a dev STUB, and an unreadable status mapping to `processing` rather
  than a terminal state (treating unknown as failed releases reserved earnings
  while the provider may still be paying). Coverage reached 79.72%/71.69% and
  the floors were ratcheted to 78/70.

**Double payout is now proven, not just reviewed.** `processPayout` had a CAS
claim and a durable account fence, but nothing raced two workers on the same
approved payout against a real database. `payout-double-execution.spec.ts`
asserts the outcome that matters — the provider was asked to move money exactly
once, one caller 2xx and one 4xx, one `payout_transaction` row, allocations
unchanged — for both the concurrent race and the sequential replay. Verified by
weakening the CAS: the replay test fails. The concurrent test still passed under
that mutation because the fence caught it independently, so defence-in-depth is
confirmed rather than assumed.

**Rule this pass earns:** _a green local run on a dirty working tree proves
nothing about a fresh checkout._ Delete build output before believing a gate.

## Branch state (2026-08-07, fourth pass)

`integration/agent-beta` is the live line. Checked every branch rather than
assuming:

- **`main` had ZERO commits not already in `integration/agent-beta`**, so the
  merge is a clean fast-forward — main becomes exactly the tree verified here,
  with no merge commit and no possibility of a different result.
- `agent/harden-production-launch-config` and `autoresearch/session-20260710`:
  0 commits not in beta. Fully absorbed; safe to delete.
- `agent/complete-hardening-and-cleanup`: 1 commit not in beta (`ac3b80e`), but
  that is the ORIGINAL squashed form of the sandbox XTS wave, which was
  re-landed as seven separate commits. Its tree is ~17k lines behind beta.
  Only 11 files exist there and not on beta, and all but one are correct
  removals:
  - `docs/legal/*.md` — deliberately moved into the component tree by A-087.
  - `apps/web/src/lib/payout-providers.ts` — deliberately replaced by runtime
    readiness (`payout-readiness.ts`).
  - `apps/vscode-extension/src/quiet-hours.ts` — a 6-line pure helper that is
    unreferenced even on its own branch. Dead code; the real quiet-hours logic
    lives in `apps/api/src/extension/quiet-hours.ts`.
  - `extension-ad-sandbox-placement.spec.ts` — present on beta as
    `extension-ad.sandbox-placement.spec.ts` (renamed, not lost).
  - `apps/cli/src/commands/sandbox.ts` — a genuinely absent sandbox-only CLI
    command (faucet/deposit/payout simulation), gated on
    `environmentKind` ∈ {sandbox,test} so it cannot run in production. Not
    launch-blocking; recover it if the sandbox economy gets used.
  - **`ad-opportunity-expiry.cron.ts` — genuinely lost, and restored.** See
    below.

**The one real loss: the ad-opportunity expiry sweep.** The tell was in the
schema, not the code: `AdOpportunity` carries `@@index([state, expiresAt])` on
beta with **no query that uses it**. An index whose only consumer is missing is
a strong signal something was dropped. Serving is unaffected (it filters
`expiresAt > now`), so this was never a correctness bug — but nothing swept or
purged `ad_opportunities` (`retention.cron`/`compliance.purge` do not cover it),
so every unclaimed opportunity stayed `candidate` forever and the table grew
without bound. Restored with its module registration and verified against the
real schema — `rejection_reason` exists, `'expired'` is already a live state,
and `EXPLAIN` shows the sweep is now an Index Scan on the previously dead index.

**23 dependabot branches** are open and untouched by this pass. They are
mechanical dependency bumps; several target actions already pinned to SHAs in
these workflows and will conflict. Review them after the launch, not before.

## Open Items (external — operator / infra / product / legal, NOT code)

1. **Independent wait attestation operation:** a real provider/bridge whose
   private key is unavailable to clients, security-reviewed, with rotation and
   revocation; the `tools/wait-attestation-bridge/` reference stub is
   **prohibited for public rewards**. `wait.earnings` must stay disabled until
   the staging experiment (immutable digest, real bridge assertion, ledger
   reconciliation, payout sandbox callback, kill-switch rehearsal, second
   operator) passes. Spec: `docs/ops/wait-attestation-launch-gate.md`.
2. **Release environment secrets:** `CONTAINER_REGISTRY` + credentials,
   `STAGING_HOST`/`USER`/`DEPLOY_KEY`/`KNOWN_HOSTS`/`DEPLOY_PATH` and the
   analogous `PRODUCTION_*` values, plus the remote Compose `.env`
   (`NODE_ENV=production`, DB/Redis URLs, JWT keys, API URL, mock-auth off).
   Missing values fail the gate by design.
3. **Public deployment — the application has never been deployed.** Corrected
   2026-08-07; the prior wording ("stale build, `/comparison` 404") understated
   this by an order of magnitude. Live probe of 21 routes on
   `www.waitlayer.com` (Vercel project `prj_V9GCWpyR3BctdDuEYgPcGusD8au9`,
   `x-vercel-cache: HIT`, `age: 881782` ≈ 10.2 days):
   - `200` — `/`, `/pricing`, `/faq`, `/manifesto`, `/changelog`, `/contact`
   - `307` — `/terms`, `/privacy`
   - `404` — `/auth/login`, `/auth/signup`, `/developer`, `/advertiser`,
     `/admin`, `/security`, `/status`, `/feedback`, `/comparison`,
     `/payout-policy`, `/advertiser-policy`, all `/legal/*`

   What is live is a marketing build that predates the entire application: no
   auth, no dashboards. `api.waitlayer.com` has no DNS record at all.
   **Architecture note (this is the good news):** auth cookies are written by
   the Next.js BFF (`app/api/auth/_lib/cookies.ts`), not by the API, so
   `__Host-` cookies live on the web origin and the API may sit on a different
   host with no cross-origin cookie problem. The only hard requirement is that
   the API is HTTPS-reachable **server-side** from the web host. Recommended
   split: web stays on Vercel (edge middleware + SRI + CSP are already tuned
   for it); API goes to a container host with managed Postgres + Redis behind
   `api.waitlayer.com`. Set `NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL` as Vercel
   **build** variables — Next inlines them at build time and runtime env does
   not reach middleware or the client bundle (A-083).

4. ~~**Docker image e2e:** `docker compose build` needs a reachable npm
   registry from the build runner.~~ **CLOSED 2026-08-07 — this was a
   misdiagnosis.** The registry was never the problem. Both images build
   locally, and the real defects were A-092 (hardcoded attestations break the
   default Docker driver), A-093 (the auto-loaded dev override builds the wrong
   stage), and A-095 (the production image could not run migrations). All three
   are fixed and verified above; the API image now boots in production mode
   with all 91 migrations applied. Remaining Docker work is genuinely external:
   pushing to a real `CONTAINER_REGISTRY` (item 2) and running the attested
   build in CI with `DOCKER_ATTEST=true`.
5. **Branch protection / CODEOWNERS enforcement:** toggles in GitHub repo
   settings (owner `Harshit-sehgal`); docs in `docs/ops/branch-protection.md`.
6. **Revoke the leaked GitHub credential** previously embedded in `origin`
   (local remote sanitized; repository operator must rotate it).
7. **Google OAuth credentials** for live Google sign-in (CSP `frame-src`
   verified live; only the ID-token callback needs real creds).
8. **PSP credentials/lifecycle (A-030):** which automated rails are enabled at
   the provider level; launch countries/currencies, KYC/tax/legal docs.
   Corrected 2026-08-07 — the prior wording ("`dodo_payments` is stub-only
   **like the others**") wrongly implied every automated rail is a stub. Actual
   split:
   - **Complete implementations, credential-gated:** `paypal_payouts`
     (`providers/paypal-payouts.provider.ts`, 238 LOC), `stripe_connect`
     (`providers/stripe.provider.ts`, 465 LOC), `wise`
     (`providers/wise.provider.ts`, 310 LOC). These call real provider APIs and
     fail closed in production without credentials.
   - **Genuine `StubPayoutProvider`s** (`payout.service.ts:47,49,50`):
     `payoneer`, `razorpay`, `dodo_payments`. Registration is blocked at
     `payout-method.trait.ts:142-160`, so they cannot be persisted even if the
     `WAITLAYER_PAYOUT_PROVIDER_STATUS` override marks them available.
   - **Available today:** only `paypal_email` and `manual`
     (`packages/shared/src/payout-providers.ts:32-45`) — both "admin-processed",
     i.e. a human sends money by hand. Do not launch on `manual` at volume: it
     has no reconciliation story. Recommended first automated rail is
     **PayPal Payouts** (lowest KYC friction for global small payouts, and the
     implementation is already done); validate with
     `apps/api/src/integration/payout-sandbox-run.spec.ts` against sandbox
     credentials before promoting via the env override.
     `README.md` already described this split correctly; this file did not.
9. **Green GitHub Actions SHA run:** `gh`/`act` unavailable in dev sandboxes;
   every CI job category has a local equivalent.
10. **Test-DB reset consent:** full `pnpm test` integration phase needs
    `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1` (operator-only action);
    individual specs run against the migrated `waitlayer_test` DB without it.

## Environment & harness rules (learned the hard way)

- **JWT keypairs:** root `.env` and `apps/api/.env` MUST hold one keypair or
  every protected-route browser test fails closed (2026-08-02, 26-test auth
  collapse). Verify with `node .e2e/verify-key-alignment.mjs` before e2e.
- **PEM values:** root `.env` keeps PEMs as single-line quoted values with
  literal `\n` escapes (docker compose cannot parse multi-line); multi-line PEM
  blocks belong in `apps/api/.env` only. Never `source` an environ dump —
  bash drops multi-line values and the API boots with ephemeral keys.
- **`NODE_ENV` isolation:** shell `NODE_ENV=development` breaks `next build`
  (static-prerender React-dispatcher crash) and `next start` (static chunk
  500s). The web build script forces `NODE_ENV=production`; launch servers with
  `NODE_ENV=production` for any browser pass.
- **Throttle overrides** (`THROTTLE_AUTH_SHORT_LIMIT` etc., defaults
  10/30/60/200) exist for isolated test/CI APIs only — never raise on a public
  production API. BruteForceGuard is separate from the throttler
  (`wl:bruteforce:*` keys).
- **Integration suites** opt into the fail-closed money switches
  (`ads.global`, `wait.earnings`, `payouts.requests`, `payouts.auto`,
  `deposits.global`) via `prisma.systemSetting.upsert` in `beforeAll`; fresh
  DBs seed them disabled. Never enable them for real money paths.
- **Services:** Postgres `:5432` (dev, `waitlayer-dev` creds), `:5433` (test,
  `waitlayer_test`), Redis `:6379`. Keep `migrate status` current and
  `migrate diff` drift-free. **Do not hardcode a migration count in prose** —
  it was stated as both `89` and `91` in three places in this file (actual: 91,
  from `find migrations -mindepth 1 -maxdepth 1 -type d`; the `0_init` directory
  is why a `grep '^2'` undercounts by one). Derive it, don't assert it.
- **Dependency audit:** the only known advisory is the quarantined dev-only
  `brace-expansion` path (`@nestjs/cli → fork-ts-checker-webpack-plugin →
minimatch@3`; no compatible parent upgrade). `scripts/audit-dependencies.mjs`
  hard-fails on anything else.
- **CI jobs:** `timeout-minutes: 30`; security job `continue-on-error: false`;
  gitleaks passes `GITHUB_TOKEN` (SARIF with `security-events: write`);
  CodeQL + trivy + license check (`scripts/check-licenses.mjs`) run.

## Bug classes fixed (invariants to preserve)

- **Multi-currency:** never compare raw minor units across currencies. Use
  `primaryCurrency()` (first positive balance in ISO-4217 order — NOT a
  magnitude claim), per-currency `CURRENCY_POLICY` (campaign min/max bid +
  budget in own minor units), currency-grouped auction (`auction.ts`,
  bigint-safe rejection sampling), and currency-grouped aggregation. Admin
  metrics take an explicit `currency` param.
- **BigInt money:** all 11 monetary columns are BIGINT; JSON serialization via
  `BigInt.prototype.toJSON` polyfill (main.ts + test-setup.ts); DTOs use
  `@IsBigInt()`/`@MinBigInt()`; clients use exact `parseMinor`/`parseMajorToMinor`
  (bigint) — no `Number()` arithmetic on money, no `::int` casts on SUMs.
- **Debug-log secret leaks:** any `console.log` printing tokens, JWT claims,
  session IDs, or response bodies is a release blocker (2026-07-13 class:
  `api-client.ts`, `jwt.strategy.ts`).
- **Audit atomicity:** mandatory financial/security audit events are written
  INSIDE their transactions with `await this.audit.logStrict(..., tx)` (fail
  closed). Best-effort observability events (`ad_served`, device reports)
  remain `void this.audit.log()` by design.
- **Payout destination encryption:** destinations encrypted AES-256-GCM at
  rest (`v1:base64(iv+cipher+tag)`), `destinationHmac` for fraud matching,
  masked in audit/API surfaces; production requires canonical base64 32-byte
  keys. `pnpm payout:encrypt-legacy` for legacy rows.
- **Payout fence lifecycle:** `initiationPayoutId` durable fence during
  ambiguous provider initiation; freeze/release guards; terminal-state-only
  release; second-person approval for high-value releases
  (`highValueFenceReleaseMinor`, default $10k); forensic metadata in the
  fenced view.
- **Wait settlement trust:** client-held HMAC/detector evidence can never
  settle earnings. Payment eligibility requires a verified `wait_attestations`
  assertion from an allowlisted external issuer (RS256, nonce-bound, replay
  CAS) PLUS distinct primary+secondary signals (`classifyWaitState`). Anomaly
  heuristics flag repeated payloads, single-primary-signal bursts, and
  identical-duration buckets. `VERIFIED_DETECTOR_VERSIONS` is telemetry-only.
- **Fail-closed switches:** missing runtime-setting rows fail closed; launch
  mode derives from the global ad/settlement switches; `telemetry_only` is the
  default until attestation + operator policy.
- **Money-path race safety:** advisory locks + CAS `updateMany` + idempotency
  keys on every money mutation; payout requests unique per allocation; partial
  approvals split ledgers with confirmed remainders (no double-split).
- **Build secret hygiene:** `tsconfig.build.json` excludes specs, fixtures,
  test-setup, and `*.test-helper.ts` from dist; `scan-build-secrets.mjs`
  hard-fails on explicit targets (Docker-image scan extracts `.next` from the
  built image); dist must contain 0 spec/test files.
- **Web deploy preflight:** `verify-deploy-env.mjs` runs as web prebuild;
  `validateWebEnv` also runs at boot under `WAITLAYER_REQUIRE_DEPLOY_ENV=1`.
  `COOKIE_SECURE=false` warns + fails preflight (never silently insecure).

## Sandbox / agent-beta domain (2026-08-05/06/07)

- **XTS economy:** `SandboxCreditAccount @@unique([userId, environmentId])`
  (+ `@@unique([id, environmentId])` composite FK); operations/entries/payout/
  deposit tables all `@@unique([accountId, idempotencyKey])` — idempotency is
  **account-scoped, not global** (different users/environments never collide).
  Serialized via `$transaction` + `pg_advisory_xact_lock(hashtextextended(environmentId:userId))`
  with P2034 retry; reset endpoint disabled until `SANDBOX_RESET_TOKEN`
  configured (constant-time compare); minted/burned classification for
  `sandbox-reconcile`; `audit.logStrict` on reset. Faucet 10k XTS, cap 100k,
  3 grants/day.
- **Placement path:** `POST /extension/sandbox-placement` serves non-cash
  placements (`mode:'sandbox'`, `hasCashValue:false`) on sandbox/test
  deployments only (`getEnvironmentKind`); `ad_opportunities` carry
  `claimIdempotencyKey` + state machine; `campaign_placements` unique per
  campaign+placementType. Web panels health-gate on `environmentKind` and
  render only on sandbox/test.
- **VSIX packaging:** `@waitlayer/agent-protocol` is a devDependency inlined
  by esbuild (494KB self-contained `out/extension.js`); `package-vsix.mjs`
  stages a dependency-free manifest; `verify-isolated-artifact.cjs` rejects any
  `@waitlayer/`/`workspace:` runtime resolution. License: `SEE LICENSE IN LICENSE`.
- **Attention coordination:** `AttentionStateMachine` enqueues
  foreground-eligible losers and promotes the first still-eligible waiter when
  the owner releases (`promotion` reason).
- **Scenario harness:** `scripts/scenario-*.mjs` + 121 scenario files under
  `scenarios/` (manifests, runners, catalog) — deterministic, disposable,
  sanitized traces, fault injection, privacy canaries. Root scripts:
  `scenario:check|catalog|coverage|report|run|repeat|triage`, `sandbox:seed|
reset|reconcile`, `test:compiled-entrypoints`.

## Verified Resolved Index (A-001…A-086, code-verified 2026-07-10 / later)

Each line: `A-0XX — what — verification evidence`. Full per-item writeups were
pruned 2026-07-10; this index preserves the audit trail.

- A-001 root build/Docker — web deps (`@tailwindcss/postcss`, `zod`) + cli `auth.test.ts` fix; `pnpm build` 9/9 — **web `next build` env-leak blocker fixed 2026-07-11** by forcing `NODE_ENV=production` in the web build script.
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
- A-014 ledger-only API key (`api-key.dto` `UNSUPPORTED_API_KEY_SCOPES`; web `createLedgerApiKey` (`apps/web/src/lib/api/services.ts`) posts `ledger:read`).
- A-015 email verify resend (`auth.controller:134`; settings/payouts pages).
- A-016 middleware `JWT_SECRET` tests (`middleware.test.ts:27`; `lib/web-env.ts:21`).
- A-017 `ConfigModule` `loadEnv` wired (`app.module.ts:43`).
- A-018 CSP `frame-src` google (`next.config.js:22`).
- A-019 deposit auto-activates approved campaign (`stripe-webhook.controller:429-456`).
- A-020 campaign pause/resume UI (`campaign-actions.ts:24-30`).
- A-021 campaign edit/archive/rejection reasons (`campaign-actions.ts`; page.tsx).
- A-022 VS Code CTA text (`extension.ts:121`; `ad-display.ts` fallback).
- A-023 deposit banner (`advertiser/page.tsx:115` — success/cancelled states; no separate pending copy).
- A-024 CTR ratio render ×100 (`advertiser.service.ts:409`; `page.tsx:169`).
- A-025 admin users shape (`admin.service.ts:296-330`; `users/page.tsx:161-192`).
- A-026 payout amount units (`admin/payouts/amounts.ts:6-8`; `amounts.test.ts`).
- A-027 device recovery issuance (`admin.controller:184,190`; `devices/page.tsx`).
- A-028 admin user lifecycle buttons (`admin/users/page.tsx:250-319`).
- A-029 feedback backend submit (`feedback/page.tsx:20`; `feedback.service.ts`).
- A-030 safe-seed payout provider catalogue (`payout-providers.ts`): `paypal_email` + `manual` available by default; automated rails remain gated; the API enforces `WAITLAYER_PAYOUT_PROVIDER_STATUS` and publishes runtime readiness to the web so no build-time client catalogue can drift.
- A-031 currency helpers in UI (relocated to `@waitlayer/shared`: `formatMinorUnits`, `minorToMajorInputValue`, `depositMinimumMinor`, `payoutMinimumMinor`).
- A-032 reports pagination bounds (`advertiser.service.ts:42-43`; `spec:237-295`).
- A-033 comparison `Live` claims over 2 codebases (`comparison/page.tsx:37-51`) — **live-verified 2026-07-15** (browser E2E).
- A-034 signup consent DTO+tx (`signup.dto.ts:43-51`; `auth.service.ts:94-97,110-172`).
- A-035 payout 2FA policy (`payout.service.ts:354,622`; `security/page.tsx:37`).
- A-036 CCPA opt-out in ad select (`extension.service.ts:628-639`; `privacy/page.tsx:67-75`).
- A-037 `RejectApiKeyGuard` on advertiser export/delete (`advertiser.controller:305-317`).
- A-038 ad cache keyed by user/device (`extension.service.ts:721-722`).
- A-039 per-currency balance (`extension.service.ts:818-821`; `advertiser-balance.ts`).
- A-040 CLI ad flow (`watch.ts` `runAdFlow`; `ad-flow.ts` `MINIMUM_VISIBLE_DURATION_MS = 5000`) — live compiled-binary↔API link verified 2026-07-12/15.
- A-041 referral reward earnings (`referral.service.ts:197-262`).
- A-042 readiness 503 (`health.controller.ts:56-84`).
- A-043 CLI packaging/shebang (`package.json` bin; `verify-cli-bin.mjs`; no `@waitlayer/shared`).
- A-044 advertiser privacy UI (`advertiser.controller:305-317`; `settings/page.tsx`).
- A-045 empty creative reject reason (`campaign.service.ts:219-233`).
- A-046 fraud recompute client (`admin.controller:153-155`; `fraud/page.tsx:217-229`).
- A-047 consent version fail-closed (`apps/api/src/compliance/consent-versions.ts:5-9`; `cookie-consent.tsx:58-85`) — full browser signup/login/dashboard E2E **live-verified 2026-07-20**.
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
- A-059 partial payout remainder (`payout.service.ts` `requestPayout→allocatePayoutEarnings:424-541`).
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
- A-075 Docker registry-resilient pnpm install (`Dockerfile` base stage, `NPM_REGISTRY`/`PNPM_VERSION` build args; `USER node` + HEALTHCHECK) — resolved 2026-07-23.
- A-076 money-integrity bounded (`admin.service.ts:69-294`).
- A-077 admin campaign queue pagination (`admin.service.ts:390-409`).
- A-078 feedback message persisted (`feedback.service.ts:47-54`; `page.tsx:38`).
- A-079 local QR (`developer/settings/page.tsx:5,171` `qrcode` toDataURL; no `googleapis`).
- A-080 shared currency constants (`payout-policy/page.tsx:4,13,14`; `pricing/page.tsx:4,56,57`).
- A-081 non-USD deposit currency (`new/page.tsx:40-67,220-233`).
- A-082 payout stub-provider registration guard (`payout.service.ts:211`; `normalizePayoutMethod` rejects non-payable providers at registration).
- A-083 web middleware `JWT_SECRET` fail-closed (`middleware.ts:58` `getJwtSecret` — build-time env inlining; requires `JWT_SECRET` at web **build** time).
- A-084 Swagger/OpenAPI model docs (`@ApiProperty` all DTO fields, `@ApiOperation` all routes).
- A-085 payout-account emergency freeze/unfreeze (`admin-payouts.trait.ts:248-322`; `admin.controller.ts:336-355`; `admin.service.spec.ts:563-720`; `admin/dto/index.ts:12`) — 409 on already-frozen, forensic beforeSnap, `payout-request.trait.ts:301` blocks developer payout on frozen accounts; `docs/ops/payout-runbook.md` §7 playbook.
- A-086 payout-account-frozen developer email alert (`email.service.ts:234-302`; `email-queue.service.ts:131-153`; `admin-payouts.trait.ts:298-321`) — best-effort (Resend outage never blocks freezing), masked destinations, 24h TTL; §7.1 step 5.

## Quality gates (run from repo root)

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

Additional gates: `node scripts/audit-claims.mjs` (13/13), `node scripts/scan-build-secrets.mjs`,
`node scripts/audit-dependencies.mjs`, `node scripts/check-licenses.mjs`,
`pnpm --filter waitlayer-web exec playwright test` (e2e, 86 tests — run via
`.e2e/run-e2e.sh`), plus migration status and drift.

**The migration-status command needs an explicit `DATABASE_URL`.** As previously
documented here it fails: `prisma.config.ts` requires `datasource.url`, and the
bare command errors with `The datasource.url property is required in your Prisma
config file`. Prefix it (and never `source` the environ dump — see the PEM rule
above):

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"') \
  pnpm --filter @waitlayer/db exec prisma migrate status
# → "N migrations found in prisma/migrations" + "Database schema is up to date!"
```

Then `prisma migrate diff --exit-code --from-config-datasource --to-schema
./prisma/schema.prisma` (no drift).

**What these gates do not cover** (learned 2026-08-07, see A-087): they assert
that builds succeed and invariants hold, never that a rendered page contains its
intended content. A page whose content silently falls back to an error string
passes every gate in this list.
