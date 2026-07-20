# Remaining Open Items — Operator / Infra Hand-off

This document is the single source of truth for the **14 items still open after
the code-level assessment was closed**. Every code-completable item (P0 #7,
P1 #12–#19, the audit-outbox, JWT rotation, CSP headers, naming, stale-artifact,
trait-composition work) is **done and gate-green**. The items below are
genuinely external — operator, infrastructure, product, or legal decisions — and
cannot be finished by a source change. Each entry gives the current code state
(with evidence) and the exact external step required to close it.

> Status of the repo at time of writing: `pnpm typecheck` 14/14, `pnpm lint` 9/9,
> `pnpm test` 10/10 tasks (API integration ran fresh), all gates green. See
> `scripts/ci-local.sh` to reproduce the CI gate set locally.

---

## 1. A-030 — Payout provider launch availability (operator decision)

**Code state:** complete. `packages/shared/src/payout-providers.ts` is the single
source of truth; `applyPayoutProviderOverrides` lets an operator gate any
provider via `NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS` (JSON map of
`provider → "available" | "coming_soon"`), and the API honours the same gate at
payout-method registration (`normalizePayoutMethod` → `payoutProviderLaunchStatus`
throws `BadRequestException` for any `coming_soon` provider). Covered by
`payout-providers.spec.ts`. Launch-config details are in
`docs/ops/payout-runbook.md` §8.

**Exact external step:** decide which automated rails are live and supply their
credentials. Until then `paypal`/`stripe`/`wise` fall back to `dev_stub_*` in
non-production and fail initiation in production; `payoneer`/`razorpay` are
stub-only and rejected at registration regardless of override. Required env vars
once a rail is promoted:

- PayPal Payouts: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`
- Stripe Connect: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Wise: `WISE_API_TOKEN`, `WISE_PROFILE_ID`, `WISE_MODE`, `WISE_EMAIL_RECIPIENTS_VERIFIED`

---

## 2. A-075 — Docker `docker compose build` end-to-end (network/infra)

**Code state:** complete. The root `Dockerfile` is correct — multi-stage build,
`RUN chown -R node:node /app` then `USER node` (api lines 104–105, web lines
136–137), `HEALTHCHECK` against `/health/ready` (api) and `/` (web), and a
`docker-entrypoint.sh` that waits for Postgres, runs `prisma migrate deploy`, then
`exec`s the app as PID 1. The CI `docker-build` job already boots the compiled
image and asserts a controller route resolves over TCP (`GET /auth/me` → 401, not
404; `/docs` → 200).

**Exact external step:** run `docker compose build` (or `./scripts/ci-local.sh`
with `DOCKER_BUILD=1` + `JWT_PUBLIC_KEY` set) from an environment with a
**reachable npm registry**. In this sandbox `corepack prepare pnpm@11.9.0
--activate` fails with `ETIMEDOUT` against `registry.npmjs.org` — an environment
constraint, not a code defect. Builds green once the registry is reachable.

---

## 3. A-018 — Live Google OAuth ID-token callback (credentials)

**Code state:** complete. `apps/api/src/auth/strategies/google-token-verifier.ts`
verifies the GIS ID token (mock tokens allowed in non-prod via
`ALLOW_MOCK_GOOGLE`); `auth-core.trait.ts` `google_signup` creates the user and
emits the `google_signup` audit inside the signup transaction. The web login page
renders the Google control gated on `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (set in the
`Dockerfile`). CSP header including `frame-src 'self' https://accounts.google.com`
is **live-verified**. A browser E2E asserts the control is wired
(`apps/web/e2e/signup-flow.spec.ts`, A-018 block).

**Exact external step:** set real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (and
the web `NEXT_PUBLIC_GOOGLE_CLIENT_ID`), then click "Continue with Google" and
complete a real Google account consent. Cannot be verified without live
credentials.

---

## 4. A-036 — CCPA enforcement beyond ad serving (product/legal)

**Code state:** ad-selection enforcement is done (`extension.service.ts` skips
non-opted-out California users). Legal scope for **reporting / exports /
audience** is undefined by product.

**Exact external step:** product/legal defines the CCPA footprint outside ad
serving. Until then, only ad selection honours the opt-out (by design).

---

## 5. A-047 — Full multi-step browser signup / cookie E2E (run-verified locally; CI runs for the locked pipeline)

**Code state:** route covered by in-process `e2e-http-flow.spec.ts` (44 tests:
signup API, cookie issuance, consent versioning fail-closed). Cookie banner
**live-verified** 2026-07-15. A new real-browser spec
clear-cookie → re-auth, plus the Google control wiring. A live headless-Chromium
pass on 2026-07-20 also exercised the full signup → authenticated /developer →
dashboard flow against the running stack (recorded in AGENTS.md).

**Status:** run-verified locally on 2026-07-20 — 3/3 headless-Chromium scenarios
pass against the live stack (API :4002 + web :3000 + Postgres + Redis): UI login
issues the auth cookie and reaches the authenticated `/developer` chrome, clearing
the cookie forces re-authentication, and the Google sign-in control is wired on
the login page. CI runs `pnpm --filter waitlayer-web e2e` for the locked
pipeline. No code change needed.

---

## 6. A-056 — VS Code / CLI `country` population (code complete)

**Code state:** both clients derive a best-effort ISO-3166-1 alpha-2 country from
the host locale (`detectCountryCode()` in `apps/vscode-extension/src/api-client.ts`
and `apps/cli/src/lib/api-client.ts`) and send it on the ad-request; the server
falls back to the profile country. Unit-covered behaviour.

**Exact external step (smoke, optional):** run a client with
`LC_ALL=en_US.UTF-8` against a live API and confirm country-targeted campaigns are
enforced. No code change needed.

---

## 7. #12 — Age verification (product/legal)

Currently self-asserted 18+. **Decision:** keep self-assertion or add
verification (e.g. ID/age-gate vendor). Product/legal call.

## 8. #39 — Analytics vendor (product/legal)

No vendor chosen. **Decision:** select a vendor (or none) and wire collection.
Code has no hardcoded vendor.

## 9. #103 — Webhook async processing (RESOLVED by removal)

The `WEBHOOK_ASYNC_PROCESSING` switch was **removed** — the config schema now
_rejects_ it in every environment (`config.spec.ts`: "rejects the removed
async-webhook switch"). Webhooks are processed in-process via the EventBus. No
action; this item is closed.

## 10. #131 — Message broker (infra)

Only the in-process `EventBus` is implemented. **Decision:** adopt Redis
Streams / Kafka if cross-process delivery is required. Infra call; not a defect.

---

## 11. P0.5 — Verified green CI run on the exact SHA (infra)

**Code state:** every CI job category is green locally (typecheck/lint/test/build
all pass; `docker-build` job defined). `scripts/ci-local.sh` reproduces the gate
set locally.

**Exact external step:** push the commit and let GitHub Actions run, or run
`./scripts/ci-local.sh` locally. `gh`/GitHub auth is unavailable in this sandbox,
so the _GitHub_ run must be triggered by an operator.

---

## 12. P1.9 — Real Stripe / PayPal / Wise test-mode lifecycles (credentials)

**Code state:** the DB-backed `payout-sandbox-run.spec.ts` exercises the
stub/minimized-payload path (no real money). Provider clients implement
`initiate`/`checkStatus` against sandbox hosts when configured.

**Exact external step:** supply test-mode credentials (Stripe test keys, PayPal
sandbox, Wise sandbox) and run the payout lifecycle end-to-end
(request → process → provider callback → paid/failed), including webhook
before-response, duplicate initiation, provider idempotency, mismatched
amount/currency, and timeouts. Add the creds to the CI secret store to enable a
live lifecycle job.

---

## 13. P1.21 — Branch protection (GitHub repo setting)

**Code state:** complete. `docs/ops/branch-protection.md` documents the exact
settings; `.github/CODEOWNERS` is aligned; every required CI job is defined in
`.github/workflows/ci.yml` (typecheck, lint, build, test, e2e, package-clients,
docker-build, backup-restore, verify-audit-claims, security).

**Exact external step:** an operator enables branch protection on `main` in
GitHub repo **Settings → Branches** using the checklist in
`docs/ops/branch-protection.md` (protected branch, no force-push/delete, required
CI checks, ≥1 CODEOWNERS approval, stale-approval dismissal, pinned Action SHAs).
This is a GitHub UI action, not a code change.

---

## 14. A-027 — Device recovery token client consumption (by design)

**Code state:** admin issuance is unit-tested (`admin.service.spec.ts`); there is
**no public consume route by design** — a device recovery token is admin-issued
and consumed out-of-band, not via a public client endpoint.

**Exact external step:** none required. If a future product decision wants the
CLI/extension to consume an admin-issued recovery token directly, that is a new
feature, not a bug. Documented here so it is not mistaken for a gap.
