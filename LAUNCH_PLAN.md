# WaitLayer Launch Plan

> Built from a fresh code audit on **2026-08-07** against `integration/agent-beta`
> @ `f5f69ec`. Every claim below was re-verified against source, a running
> database, or a live HTTP probe. Where this document disagrees with `AGENTS.md`,
> `README.md`, or `FOUNDATION_STATUS.md`, this document is the one that was
> checked today.

---

## 0. Headline

**Engineering quality is not the problem.** Every gate is green, the money-path
invariants are real and enforced, and the fail-closed design is honest. The
problem is that **none of it is reachable, nobody can operate it, and the core
value proposition is switched off with no supplier able to switch it on.**

Four facts define the whole plan:

1. **The application has never been deployed.** `www.waitlayer.com` serves an
   ~10-day-cached marketing build with 8 pages. `/auth/login`, `/auth/signup`,
   `/developer`, `/advertiser`, `/admin` all 404. `api.waitlayer.com` has no DNS.
2. **A fresh production database cannot produce an admin.** There is no seed,
   script, or endpoint that creates one — so no campaign can be approved, no
   kill-switch can be flipped, and no payout can be processed. The product would
   boot inert.
3. **`wait.earnings` cannot be enabled by configuration.** It requires an
   independently-operated attestation issuer. No AI provider signs wait
   assertions today, and the only bridge in the repo is a stub that hardcodes a
   5-second duration. This is an architecture decision, not a config item.
4. **One real code bug is live right now.** The three `/legal/*` pages — linked
   from the footer of every page — have "Content unavailable" baked into their
   prerendered HTML in every build, including local. Proven by decoding the
   build artifact, not inferred (§B6). It is an hour's work and the only finding
   here with a regulatory edge.

The one-sentence version: **the gates measure the code, and the code is fine;
nothing measures the product, and the product does not run.**

---

## 1. Verified state (gates I ran today)

| Gate                                   | Result                        | Notes  |
| -------------------------------------- | ----------------------------- | ------ |
| `pnpm typecheck`                       | **17/17 pass**                |        |
| `pnpm lint`                            | **11/11 pass**                | exit 0 |
| `pnpm build`                           | **11/11 pass**                |        |
| API unit (`vitest`, excl. integration) | **1306/1306**, 127 files      | 66s    |
| Web tests                              | **203/203**, 49 files         |        |
| CLI tests                              | **123/123**, 20 files         |        |
| `scripts/audit-claims.mjs`             | **13/13 PASS**                |        |
| `scripts/audit-dependencies.mjs`       | clean                         |        |
| `prisma migrate status` (dev :5432)    | **91 migrations, up to date** |        |
| Postgres :5432 / :5433, Redis :6379    | up, healthy                   |        |

Engineering quality is genuinely high. Advisory locks, CAS updates, BIGINT money,
per-currency policy, encrypted payout destinations, atomic audit writes,
fail-closed switches — all present and tested. Treat this section as the reason
to trust the codebase and spend your effort on §3–§5 instead.

---

## 2. Doc ↔ code inconsistencies

These are stale claims, not bugs. **All eight have been corrected in the repo as
of 2026-08-07** — the table is retained as the record of what was wrong and why.

| #   | Inconsistency                                                                                 | Reality                                                                                                                                                                                                         | Status                                                                                 |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| D1  | `AGENTS.md` said **91 migrations** in one place and **89** in two others                      | 91 (`find migrations -mindepth 1 -maxdepth 1 -type d`). Note `0_init` doesn't start with `2`, so a `grep '^2'` undercounts by one — that tripped me up mid-audit                                                | ✅ replaced with a "don't hardcode this" rule                                          |
| D2  | `AGENTS.md` open item #8: "`dodo_payments` is stub-only **like the others**"                  | Misleading. PayPal Payouts (238 LOC), Stripe Connect (465 LOC) and Wise (310 LOC) are **complete** API integrations gated on credentials. Only `payoneer`, `razorpay`, `dodo_payments` are `StubPayoutProvider` | ✅ rewritten with the three-way split                                                  |
| D3  | `AGENTS.md` listed `prisma migrate status` as a gate command                                  | **Fails as written** — `prisma.config.ts` requires `datasource.url`; needs `DATABASE_URL=…` prefixed                                                                                                            | ✅ working command documented                                                          |
| D4  | `AGENTS.md` open item #3: "`/comparison` 404 on www"                                          | Understated. 13 of 21 probed routes are 404, including all auth and all dashboards                                                                                                                              | ✅ rewritten with the full probe + topology guidance                                   |
| D5  | `FOUNDATION_STATUS.md` — 77 KB, "Last updated 2026-07-11", claims "14/14 typecheck, 9/9 lint" | Now 17/17 and 11/11. Also claims "no silently-failing domains", which B6 disproves                                                                                                                              | ✅ superseded banner listing its known-stale claims (kept as audit trail, not deleted) |
| D6  | `README.md` "Core Features" reads as though the money loop is live                            | All five switches fail closed; no rail is live                                                                                                                                                                  | ✅ switch-state table added                                                            |
| D7  | `AGENTS.md`: "all source-fixable issues resolved… **no source edit can close them**"          | **False.** B1/B6/B7/B8 are all pure source fixes                                                                                                                                                                | ✅ corrected; tracked as **A-087…A-090**                                               |
| D8  | No doc anywhere records that green gates ≠ working product                                    | B6 passes every gate and is broken                                                                                                                                                                              | ✅ noted in `AGENTS.md` gates section                                                  |

**Cross-reference:** the four code blockers below are tracked in `AGENTS.md` as
**A-087** (legal pages = B6), **A-088** (admin bootstrap = B1), **A-089**
(beta disclosure = B8), **A-090** (developer onboarding = B7).

---

## 3. Launch blockers — P0

### B1 — No production admin can exist _(not tracked anywhere today)_

**Evidence.** `apps/api/src/auth/dto/signup.dto.ts:25` rejects privileged roles
("privileged roles cannot be self-assigned"). `apps/api/src/admin/admin.controller.ts:56-58`
is `@UseGuards(JwtAuthGuard, RolesGuard, AdminMfaStepUpGuard)` + `@Roles('admin','super_admin')`.
An exhaustive search of `apps/`, `packages/`, `scripts/`, `docs/ops/` finds **no**
code that creates an admin — except `scripts/enforce-health-metrics.mjs:79-88`,
a CI helper that creates a **passwordless** admin user.
`docs/ops/deployment-checklist.md` has no bootstrap step.

**Impact.** On a fresh production DB nobody can:

- approve a campaign → `campaign.service.ts:197-209` requires `status='approved'` before `active`
- flip any of the 5 fail-closed switches → `admin.controller.ts:561` is the only writer
- verify a payout account (`schema.prisma:368` `isVerified` gates payouts)
- process a manual payout, freeze an account, or review fraud

The product boots and does nothing, permanently.

**Solution.** Add `scripts/bootstrap-admin.mjs`:

- refuses to run unless `ADMIN_BOOTSTRAP_TOKEN` matches a value only in the secret manager
- refuses if any `admin`/`super_admin` row already exists (one-shot, idempotent)
- requires email + password validated by the existing `IsStrongPassword` rules; sets `emailVerified: true`
- writes an `audit_logs` row via `logStrict`
- prints the TOTP enrolment requirement — `AdminMfaStepUpGuard` already forces 2FA on first privileged call

Then: add it as **step 1** of `docs/ops/deployment-checklist.md`, and add a hard
`NODE_ENV=production` refusal to `scripts/enforce-health-metrics.mjs`.

**Effort: 1 day.**

---

### B2 — The application has never been deployed

**Evidence.** Live probe of `www.waitlayer.com`:

```
200  /  /pricing  /faq  /manifesto  /changelog  /contact
307  /terms  /privacy
404  /auth/login  /auth/signup  /developer  /advertiser  /admin
     /security  /status  /feedback  /comparison  /payout-policy
     /advertiser-policy  /legal/*
```

`x-vercel-cache: HIT`, `age: 881782` (≈10.2 days). `api.waitlayer.com` → no DNS.

**Architecture note (good news).** Auth cookies are written by the **Next.js BFF**
(`apps/web/src/app/api/auth/_lib/cookies.ts`), not by the API. So `__Host-`
cookies live on the web origin and the API can sit on a different host with no
cross-origin cookie problem. The only requirement is that the API is
HTTPS-reachable _server-side_ from the web host.

**Solution — recommended topology:**

- **Web** stays on Vercel (edge middleware, SRI, and `next.config.js` CSP are
  already tuned for it). Redeploy from current `main`.
- **API** → container host (Fly.io / Railway / Render / ECS) using the existing
  `api` Docker target, + managed Postgres + managed Redis. Point
  `api.waitlayer.com` at it.
- Set `NEXT_PUBLIC_API_URL=https://api.waitlayer.com/api/v1` and
  `API_INTERNAL_URL` in Vercel **build** variables — `next.config.js`/middleware
  inline these at build time (A-083), runtime env does not reach them.
- Fill the `staging.yml` secrets (`CONTAINER_REGISTRY`, `STAGING_*`,
  `PRODUCTION_*`). The pipeline already does image signing, digest-pinned
  promotion, migrate-before-deploy, and a smoke test — it just has no
  credentials.

The alternative (both services on one host via `docker-compose.yml` behind a
reverse proxy) is simpler to reason about but throws away the Vercel edge setup.
I'd take the split.

**Effort: 3–5 days including DNS, TLS, secrets, and a green staging run.**

---

### B3 — The core value proposition cannot be turned on

**Evidence.** `runtime-config.service.ts:367` — `wait.earnings` defaults false.
`getWaitLaunchMode()` (`:410`) returns `earnings_enabled` only with a configured
external issuer **and** version allowlist. `extension-ad.trait.ts:244-251` refuses
to serve any monetizable ad otherwise. `docs/ops/wait-attestation-launch-gate.md`
requires an issuer "whose signing key is not available to WaitLayer clients."
`tools/wait-attestation-bridge/README.md` admits the stub "always signs a fixed
5-second duration" and is "prohibited for production."

**The real problem.** There is no third party to integrate with — **no AI
provider signs wait attestations.** You cannot satisfy this gate by finding a
vendor. You have to build the independent measurer yourself, or not settle.

**Three paths:**

**Path A — first-party measurement gateway (recommended for monetization).**
WaitLayer operates an HTTPS gateway that the CLI/extension routes provider calls
through (developer brings their own provider key). The gateway measures
start/end server-side and signs the assertion with a KMS-held key that never
touches a client. This satisfies the launch gate's trust boundary _literally_.

The privacy trap: a naive reverse proxy sees prompt plaintext, which contradicts
the entire product positioning. **Build it as a CONNECT/TLS tunnel** — you
measure connection open → first byte → last byte and byte counts, and never see
plaintext. That is enough to attest a wait and keeps the privacy claim true.
Costs: +10–30 ms latency, egress bills, and a real security review.

**Path B — launch the non-billable beta as designed (recommended for _now_).**
Ship `telemetry_only`, say so loudly in the UI (see B8), build developer supply
and an advertiser waitlist, defer settlement. This is exactly what the code was
built for and needs no new trust machinery.

**Path C — client attestation.** macOS App Attest / Play Integrity don't cover
VS Code or a Node CLI. Not viable. Reject.

**Recommendation: B now, A next.** Launch the beta in weeks; monetize in a
quarter. Do not let B3 block B1/B2 — a telemetry beta still needs a deployed app
and an operator.

**Effort: Path B ~1 week (mostly B8). Path A 3–4 weeks + security review.**

---

## 4. Launch blockers — P1 (before real money moves)

### B4 — No usable payment rail

Only `manual` and `paypal_email` are `available`
(`packages/shared/src/payout-providers.ts:32-45`), and both are "admin-processed
at launch" — a human sending money by hand. The three real integrations are
credential-gated behind `WAITLAYER_PAYOUT_PROVIDER_STATUS`, with a correct
server-side guard at `payout-method.trait.ts:142-160`.

**Solution.** Pick **PayPal Payouts** — lowest KYC friction for global small
payouts and the implementation is already complete. Get sandbox credentials, run
`apps/api/src/integration/payout-sandbox-run.spec.ts` against them, then promote
via env override. **Do not launch on `manual` at any volume** — it does not scale
past ~20 payouts and has no reconciliation story.

> **Updated 2026-08-17 by decision D4 in `DODO_PAYMENTS_PLAN.md`.** Dodo exposes
> no third-party payout API (its payout surface is read-only and settles the
> platform's own earnings), so developer payouts **cannot** run on Dodo. Launch
> is therefore on `manual`/`paypal_email` (admin-processed, W2.B); PayPal
> Payouts remains the recommended **first automated rail later**, once its
> credentials are funded, but it is no longer the launch path.

### B5 — Advertiser funding is off

`deposits.global` fails closed; no `STRIPE_SECRET_KEY`. The config schema
correctly requires `STRIPE_WEBHOOK_SECRET` whenever the key is set
(`packages/config/src/index.ts:652`).

> **Superseded 2026-08-17 by decision D1/D2 in `DODO_PAYMENTS_PLAN.md`.** The
> money-in rail is **Dodo Payments** (Merchant of Record), not Stripe; Stripe
> stays in the tree but is **inactive at launch**. See that plan's W1 (Dodo
> deposit rail + Standard-Webhooks reconciliation + reclaim cron) and §8 for the
> remaining operator inputs (live key + webhook secret, wallet-top-up product,
> MoR fee treatment).

**Solution.** Dodo test → live: create the wallet-top-up product (§8.3), run
`apps/api/src/integration/dodo-deposit-sandbox.spec.ts` against the test
endpoint, verify `payment.succeeded`/`refund.succeeded`/`dispute.*` amount units
against a real test webhook (§8.5), then enable `deposits.global`.

### B6 — Three legal pages ship "Content unavailable" in **every** build _(proven by execution — escalated 2026-08-07)_

> **Correction.** My first pass called this a production file-tracing problem.
> That was wrong about the mechanism and too generous about the severity. I
> decoded the build output rather than reasoning about it, and the truth is
> simpler and worse: **these pages have never worked, in any build, including
> local.**

`apps/web/src/app/legal/{cookie-policy,data-retention,gdpr-dpa}/page.tsx:8` read
`path.join(process.cwd(), 'docs', 'legal', '*.md')`. During `next build` the cwd
is `apps/web` — and the markdown lives at **repo-root** `docs/legal/`. There is
no `apps/web/docs/` and there never has been, so every read throws ENOENT and the
`try/catch` silently substitutes the fallback string.

All three routes are **prerendered static** (confirmed in the route manifest
inside `.next/standalone/apps/web/server.js`), so the fallback is frozen into the
HTML at build time. It cannot self-heal at runtime even if you fixed file
placement on the server.

Decoded from the actual build artifact:

```
.next/server/app/legal/gdpr-dpa.html  <pre> contains, verbatim:
  '# GDPR Data Processing Agreement\n\nContent unavailable.'

docs/legal/gdpr-dpa.md  is 82 lines, starting:
  '# WaitLayer — GDPR Data Processing Agreement (DPA)'
```

**Why this matters more than it looks.** All three are linked from
`components/site-footer.tsx:213,221` — that is _every page on the site_ — and
from `app/privacy/page.tsx:104`. The moment you deploy, you publish an empty
GDPR DPA, an empty cookie policy, and an empty data-retention policy, each one
prominently linked. That is a compliance exposure, not a cosmetic bug.

Secondary defect: content renders inside `<pre>`, so even when loaded users see
literal `#` and `**`.

**Why no gate caught it.** Typecheck, lint and build all pass — the code is
valid and the build genuinely succeeds. No e2e test visits `/legal/*`. This is
the clearest evidence in the audit that green gates prove invariants, not
behaviour.

**Solution.** Move the three files to `apps/web/src/content/legal/*.md` and
`import` them (bundled and traceable), or inline as TSX the way `/terms` and
`/privacy` already are. Render through `prose-wl`, not `<pre>`. Add a Playwright
assertion per page on expected body text. **Remove the silent fallback** — a
missing legal document should fail the build, not render an apology.

_Small enough to fix in well under an hour; it is the cheapest item in this
document and the only one with a regulatory edge._

### B7 — Signed-up developers have no path to start

`apps/web/src/app/developer/page.tsx` (595 lines) contains **zero** references to
the extension, the CLI, install commands, or device registration. And neither
client is published — I checked: `registry.npmjs.org/waitlayer-cli` → **404**,
VS Code Marketplace `waitlayer.waitlayer-vscode` → **404**. Both sit at `0.0.1`.

**Solution.** Publish both — `publish-vscode.yml` / `publish-cli.yml` and the VSIX
isolation gates already exist and are proven. Then add a "Get started" panel to
the developer dashboard: marketplace link, `npm i -g waitlayer-cli`, and a live
"device connected" indicator so activation is observable.

### B8 — No beta-state disclosure in the web app

`getWaitLaunchMode()` is consumed **only** by `extension-ad.trait.ts:244`. The web
app never reads it. A developer signs up, lands on an empty earnings dashboard,
and is told nothing. Given the marketing site talks about earning, this is a
consumer-protection exposure, not just a UX gap.

**Solution.** Expose launch mode on a public endpoint; render a persistent banner
across `/developer/*` explaining telemetry-only mode and what would change; gate
the payout CTA on it. Ship this **before** taking any public signups.

---

## 5. P2 — operational readiness

- **Revoke the leaked GitHub credential** (`AGENTS.md` open item #6). Do this
  today, independent of launch timing.
- Enable branch protection + CODEOWNERS (`docs/ops/branch-protection.md`).
- Google OAuth production credentials (CSP `frame-src` is already verified live).
- **Backups:** `scripts/backup-db.sh` + `verify-backup.mjs` exist and CI has a
  `backup-restore` job — needs a real scheduled target and **one rehearsed
  restore** against production-shaped data.
- **Alerting:** the API already emits `ledger_discrepancy`,
  `payout_paid_without_provider_tx`, `payout_fence_age`, `audit_dead_letter`,
  `payout_escalation` (seen live in the test run). Wire `SENTRY_DSN` +
  `OPS_ALERT_EMAIL` and route these to a human before any money moves.
- `ALLOWED_COUNTRIES` / `ALLOWED_CURRENCIES` are required in production and are a
  **product/legal decision** — nobody has made it yet.
- Uptime monitoring for `api.waitlayer.com` once it exists; `/status` already
  proxies the API health contract (`app/api/platform-health/route.ts`).

---

## 6. Sequenced plan

### Phase 0 — Unblock operations ✅ **COMPLETE 2026-08-07**

1. ~~Fix D1–D8 doc drift; supersede `FOUNDATION_STATUS.md`.~~ **✅ done**
2. ~~B6 / A-087 legal-page fix.~~ **✅ done** — content moved into the component
   tree, filesystem read and silent fallback deleted, verified by decoding the
   build artifact.
3. ~~B1 / A-088 admin bootstrap.~~ **✅ done** — `pnpm bootstrap:admin`,
   token-gated, one-shot, audited; deployment checklist Step 0; CI helper now
   refuses production.
4. ~~B8 / A-089 launch-mode disclosure.~~ **✅ done** — published on `/health`,
   banner on every `/developer/*` route, payout CTA gated.
5. ~~B7 / A-090 developer onboarding.~~ **✅ done** — `GET /developer/devices`
   - self-hiding Get Started panel.
6. ~~Gate class fix.~~ **✅ done** — `apps/web/e2e/public-content.spec.ts`,
   28 tests asserting rendered content on 11 public routes.
7. ~~A-091 js-yaml advisory.~~ **✅ done** — security floor override.
8. **Revoke the leaked GitHub credential; enable branch protection.**
   ⚠️ **Still open — operator action, cannot be done from the codebase.**

**Exit criteria met:** a fresh DB can produce a 2FA-enrolled admin who can flip
the switches, the legal pages serve their real content, and a developer who
signs up is told both what to install and that settlement is off.

**Gates after Phase 0:** typecheck 17/17 · lint 11/11 · build 11/11 · API unit
1316/1316 · web 203 · cli 123 · vscode 142+1 · shared 77 · **e2e 114/114** ·
audit-claims 13/13 · scan-build-secrets PASS · deps clean · `pnpm audit --prod`
clean.

### Phase 1 — Get it online (weeks 1–2)

**The code-side blockers in this phase are now closed.** I built the images and
booted the API in production mode — something nobody had done — and found three
defects that would each have stopped a deployment dead. All fixed and verified:

- ~~**A-092** `docker compose build` failed on a stock Docker install~~ ✅ —
  hardcoded `provenance`/`sbom` are unsupported by the default driver; now
  `${DOCKER_ATTEST:-false}`, opt-in for CI/release.
- ~~**A-093** `docker compose` on a deploy host builds the **dev** image~~ ✅ —
  the committed `docker-compose.override.yml` is auto-loaded and forces
  `target: build`, `NODE_ENV=development`, and mock Google auth **on**. Proven:
  the compose-built image has the full repo source and no Prisma CLI.
  `docs/ops/rollback.md` had told operators to run bare `docker compose up`
  during an incident. Corrected, and `deploy-preflight` now hard-fails on it.
- ~~**A-095** the production image could never run migrations~~ ✅ —
  `prisma.config.ts` imports `prisma/config`, but the CLI is installed globally
  and a global install isn't on Node's resolution chain, so every container
  died on "The datasource.url property is required". Fixed with `NODE_PATH` +
  running migrate from `packages/db`; **all 91 migrations verified applying
  from inside the container.**
- **A-094** `pnpm deploy:preflight` ✅ _(new)_ — validates an actual
  environment, not the code: the override trap, full config schema,
  `COOKIE_SECURE`, mock-auth flags, test-only `THROTTLE_*`, the stub attestation
  bridge, Postgres/Redis reachability, unfinished migrations, **whether an
  administrator exists and has TOTP**, and which money switches are live.
  10 tests in `test:release-gates`.

Remaining, and genuinely operator-only:

5. Provision managed Postgres + Redis; deploy API image; `api.waitlayer.com` DNS + TLS.
6. Fill `staging.yml` secrets; get one **green** staging run with the smoke test.
7. Redeploy web from `main` with correct build-time env; verify all 21 routes.
8. Sentry + alert routing; first backup + one rehearsed restore.

Run `pnpm deploy:preflight --with-db` on the host first — it converts most of
step 5–7's failure modes into a checklist that fails before users see them.

**Exit:** signup → login → developer dashboard works on the public domain.

### Phase 2 — Make the beta usable (weeks 2–3)

**Code-side work here is complete.** Verified 2026-08-07:

- ~~B8 / A-089 launch-mode banner + public endpoint~~ ✅ published on `/health`,
  rendered from the `/developer` layout, payout CTA gated.
- ~~B7 / A-090 developer onboarding~~ ✅ `GET /developer/devices` + a Get Started
  panel that self-hides once a client connects.
- ~~A-099/A-100 — nobody could enable 2FA~~ ✅ this blocked _both_ admin writes
  and developer payouts. `/admin/security` added; the re-auth proof is now sent.
- ~~Clients build and package cleanly~~ ✅ CLI exercised against a live
  production API (correct loopback warnings, commands resolve); VSIX packaged →
  extracted → `verify-vsix-artifact` **PASS**, zero runtime dependencies,
  `waitlayer.apiUrl` defaults to `https://api.waitlayer.com/api/v1`.

Remaining, operator-only:

10. **Publish the clients** — npm and the VS Code Marketplace both still 404.
    The workflows and isolation gates exist; they need registry tokens. Then
    flip `CLIENTS_PUBLISHED` in `components/developer-get-started.tsx` so the
    panel links to real install targets instead of build-it-yourself instructions.
11. Advertiser waitlist (no billing yet).

**Exit:** a stranger can sign up, install, connect a device, and see verified
wait telemetry — with the non-billable state stated plainly.

### Phase 3 — Turn on money (weeks 4–8)

13. **Dodo** test → live (per `DODO_PAYMENTS_PLAN.md` D1/D2 — Stripe is inactive
    at launch); enable `deposits.global` (B5).
14. Launch payouts on `manual`/`paypal_email` (W2.B); validate PayPal Payouts
    sandbox → live as the first automated rail later; enable `payouts.requests`
    (B4).
15. First admin campaign approval; enable `ads.global` for a canary advertiser.

**Exit:** advertisers can fund and run campaigns; developers can be paid — with
settlement still gated on attestation.

### Phase 4 — Attestation and settlement (quarter)

16. Build the Path-A TLS-tunnel measurement gateway; KMS signing key.
17. Security review of issuer/key rotation and assertion schema.
18. Run the full mandatory launch experiment in
    `docs/ops/wait-attestation-launch-gate.md` §"Mandatory launch experiment".
19. Second-operator sign-off; enable `wait.earnings` for a monitored canary.

**Exit:** the actual product thesis is live.

---

## 7. Decisions I need from you

1. **Path B then A, or straight to A?** B gets you a public launch ~4 weeks
   sooner. This is the single highest-leverage call in the document.
2. **API host** — Fly / Railway / Render / ECS, or collapse onto one box with
   Compose and drop Vercel?
3. **Launch geography and currencies** — `ALLOWED_COUNTRIES` and
   `ALLOWED_CURRENCIES` are required in production and gate KYC/tax scope.
4. **First payout rail** — I recommend PayPal Payouts. Confirm or override.
   _(Answered 2026-08-17: payouts launch on `manual`/`paypal_email` per D4/W2.B
   in `DODO_PAYMENTS_PLAN.md`; PayPal Payouts is the first automated rail later
   — see §8.2 of that plan.)_
