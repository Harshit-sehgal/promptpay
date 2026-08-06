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
- Issues A-001…A-091 are resolved and gate-verified.
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

## Resolved 2026-08-07 (second pass) — A-092…A-095, deployability

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

**Rule this pass earns:** _build and boot the artifact you intend to ship._
A-087 hid because nothing rendered a page; A-092/093/095 hid because nothing
ever built the production image and started it.

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
- A-030 safe-seed payout provider catalogue (`payout-providers.ts`): `paypal_email` + `manual` available by default; `paypal_payouts`, `stripe_connect`, `wise`, `payoneer`, `razorpay` coming_soon; `applyPayoutProviderOverrides` + server-side `normalizePayoutMethod` gate via `NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS`.
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
