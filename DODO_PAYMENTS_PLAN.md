# Dodo Payments Migration & Launch Plan

> Written 2026-08-17 from a source audit of the current tree. Companion to
> `LAUNCH_PLAN.md` and `AGENTS.md` — where those describe the general launch,
> this document is the **payment-rail workstream**: moving money-in and
> money-out to Dodo Payments, deactivating Stripe, and the payment-adjacent
> gaps that must close before a real launch.
>
> Every file pointer below was verified against source today. Line numbers can
> drift; re-read before editing.

---

## Status (code, 2026-08-17)

Landed in the tree (see `AGENTS.md` "Resolved 2026-08-17"):

- **W1.1** ✅ deposit-processor abstraction (`DEPOSIT_PROCESSOR`), fail-closed 400.
- **W1.2** ✅ `DodoProvider` (checkout over `fetch`) + config schema/env +
  `readiness()` surfaced on `GET /health` as a fail-closed `deposits` field
  (`{ enabled, processor, ready }`), so a health-adjacent surface reports the
  rail without attempting a checkout. Runtime readiness requires all four
  values (`DODO_API_KEY`, `DODO_BASE_URL`, `DODO_WEBHOOK_SECRET`,
  `DODO_PRODUCT_ID`): a checkout without a webhook secret could take money
  that the ledger cannot safely reconcile. `DODO_BASE_URL` is restricted to the
  documented HTTPS test/live hosts, and the returned checkout URL is validated
  as public HTTPS before the browser receives it.
- **W1.3** ✅ `DodoWebhookController` with **Standard Webhooks** signature
  verification + idempotent `payment.succeeded` deposit credit + A-019
  activation + `refund.succeeded` reversal + `dispute.opened`/`won`/`cancelled`/
  `lost`/`accepted` hold/restore/write-off lifecycle. Field names pinned from
  Dodo's generated Go SDK (`Refund`/`Dispute` structs). A refund overlapping an
  open dispute, and payout/subscription/unknown events, are retained
  `pending_review` (never guessed, never silently dropped). The **reclaim cron
  equivalent** is the generalized `WebhookReclaimCronService`: Dodo rows are
  re-processed from the full event retained at receipt time (Dodo has no
  event-retrieval API), and a duplicate delivery re-processes idempotently
  instead of acknowledging.
- **Migration** ✅ `20260817000000_dodo_payment_reference` adds
  `AdvertiserLedger.dodoPaymentId` + `dodoDisputeId`.
- **W1.4** ✅ web surface: billing page redirects to the returned `url`
  unchanged; advertiser/billing copy names Dodo Payments.
- **W3** ✅ Stripe fail-closed + `deploy-preflight` half-config/test-endpoint checks.
- **W5** ✅ legal copy: GDPR DPA sub-processors name Dodo Payments (Merchant of
  Record) and mark Stripe inactive; advertiser-policy + billing page name Dodo.
- **W1.5** ✅ codeable gates: A-107 authenticity/refund/dispute unit+contract
  specs; opt-in Dodo sandbox integration spec (`dodo-deposit-sandbox.spec.ts`,
  skips cleanly without `RUN_DODO_SANDBOX=1` + §8.1/§8.3 creds); content-gate
  browser e2e (`dodo-deposit.spec.ts`, asserts the Dodo rail renders + fails
  closed with no processor configured); dev + production e2e suites green. The
  opt-in `pnpm dodo:verify-live` command checks the live `/products` endpoint
  without printing secrets or enabling any money switch. The read-only
  `pnpm dodo:reconcile` command compares retained Dodo events with advertiser
  and platform ledger references, flags duplicate/orphaned/mismatched rows,
  and explicitly reports that a live provider balance comparison remains
  unavailable until Dodo credentials and a provider-side export are supplied.

Blocking before any real deposit: §8.1 (live key + webhook secret), §8.3
(product + currencies), §8.5 (MoR fee treatment + confirming the
`payment.succeeded`/`refund.succeeded`/`dispute.*` amount units against a live
webhook). The reconciliation command is platform-side evidence only; it does
not close those operator-owned live-provider checks.

---

## 0. Decision record (operator, 2026-08-17)

| ID  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Dodo Payments is the sole money-in rail for launch** — advertiser deposits use Dodo. Developer payouts are a separate platform-rail decision because Dodo cannot pay third parties (D4/D5).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | **Stripe is NOT active at launch.** Code, tests and providers stay in the tree (reversible); production env carries no Stripe credentials and every Stripe surface fails closed. Revisit later.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | **(2026-08-17)** Operator supplied a Dodo API key. **Verified live: it is a TEST key** (`GET /products` → 200 on `https://test.dodopayments.com`, 401 on live). Stored only in gitignored `.env` + `apps/api/.env` as `DODO_API_KEY` with `DODO_BASE_URL=https://test.dodopayments.com`. A **live key is still pending** — never launch on the test base URL.                                                                                                                                                                                                                                                                  |
| D4  | **(2026-08-17, verified from Dodo's docs + API index)** Dodo has **no third-party payout API**. Its payout endpoints are read-only (`List Payouts`, `Payout Breakup`, CSV) and settle the _merchant's own_ earnings to bank accounts that must match the verified entity ("cannot process payouts to mismatched or third-party accounts"). **W2.A is infeasible — W2.B is the branch**, architecturally, not just provisionally. Dodo deposits settle to the platform's bank on a bi-monthly/weekly/monthly cycle (min $50 USD threshold, MoR fees/taxes deducted first); developer payouts run from the platform's own rails. |
| D5  | **(2026-08-19)** Operator decision: developer payouts are **deferred until a later automated rail** (PayPal Payouts/Wise after credentials and sandbox evidence). Keep `payouts.requests` and `payouts.auto` OFF for launch; `manual`/`paypal_email` remain implemented and fail-closed in the catalogue but are not the launch payout operation.                                                                                                                                                                                                                                                                              |
| D6  | **(2026-08-19)** Operator decision: enable Google OAuth at launch once the matching server/web client IDs are provisioned. Mock Google remains prohibited in production; email/password remains available as a fallback.                                                                                                                                                                                                                                                                                                                                                                                                       |

Open questions requiring operator input are in **§8**. Nothing in §1–§7 should
start on Dodo credentials-dependent work until §8 items 1–3 are answered.

---

## 1. Verified current state (the rails as they exist today)

### Money-in (advertiser deposits) — processor-selected, Dodo at launch

- `POST /advertiser/deposit-session`
  (`apps/api/src/advertiser/advertiser.controller.ts`) gates on
  `runtimeConfig.isDepositsEnabled()` (`deposits.global` switch), re-checks
  per-currency minimums, and resolves the configured
  `DepositProcessorService`. Unset, unknown, or incomplete configuration
  fails closed with the existing clean 400; the controller is no longer
  coupled directly to Stripe.
- `DodoProvider.createDepositSession`
  (`apps/api/src/payout/providers/dodo.provider.ts`) creates a Dodo Checkout
  Session over `fetch` and returns `{ sessionId, url }`. Runtime readiness
  requires `DEPOSIT_PROCESSOR=dodo` plus `DODO_API_KEY`, `DODO_BASE_URL`,
  `DODO_WEBHOOK_SECRET`, and `DODO_PRODUCT_ID`; the base URL is restricted to
  Dodo's HTTPS test/live hosts and the returned checkout URL is restricted to
  public HTTPS before reaching the browser.
- Reconciliation is handled by `DodoWebhookController`
  (`apps/api/src/payout/dodo-webhook.controller.ts`,
  `POST /payout/dodo/webhook`): Standard Webhooks signature verification on
  the raw body, idempotent payment credit keyed by Dodo payment id,
  refund/dispute hold/restore/write-off handling, and deposit-triggered
  campaign activation. Unknown or ambiguous events remain `pending_review`.
- `WebhookReclaimCron` (`apps/api/src/payout/webhook-reclaim-cron.service.ts`)
  re-processes stalled events for both rails. Dodo retains the full event at
  receipt because Dodo has no event-retrieval API; duplicate deliveries are
  re-processed idempotently rather than acknowledged as complete.
- Web UI: `apps/web/src/app/advertiser/billing/page.tsx` builds the amount,
  calls `POST /advertiser/deposit-session`
  (`apps/web/src/lib/api/services.ts`) and redirects the browser to the
  provider-returned `url`; return handling remains on
  `apps/web/src/app/advertiser/page.tsx` via `?deposit=success|cancelled`.
- Stripe code remains available but inactive at launch under D2. A stray
  Stripe configuration does not select the rail; production preflight rejects
  half-configured Stripe and the selected processor must be Dodo before real
  deposits can be enabled.

### Money-out (developer payouts) — Dodo is a stub today

- Provider map (`apps/api/src/payout/payout.service.ts:42-51`):
  `manual` and `paypal_email` are real admin-processed rails; `paypal_payouts`
  (238 LOC), `stripe_connect` (465 LOC) and `wise` (310 LOC) are complete,
  credential-gated API integrations; `payoneer`, `razorpay` and
  **`dodo_payments` are `StubPayoutProvider`s** (`:50`).
- Registration of stub/non-payable providers is **blocked** in
  `PayoutMethodTrait` (`apps/api/src/payout/payout-method.trait.ts`) even if
  `WAITLAYER_PAYOUT_PROVIDER_STATUS` marks them available.
- Provider contract: `PayoutProviderHandler`
  (`apps/api/src/payout/payout/constants.ts:26`) —
  `readiness?()`, `initiate({payoutRequestId, destination, amountMinor,
currency}) → {providerTxId, providerFundingTxId?, status}`,
  `checkStatus(providerTxId, ctx?)`, optional `reconcileByReference`.
- Catalogue: `packages/shared/src/payout-providers.ts:73` lists
  `dodo_payments: 'coming_soon'`. Runtime availability comes from
  `WAITLAYER_PAYOUT_PROVIDER_STATUS` (+ the build-time
  `NEXT_PUBLIC_` twin consumed by the payouts UI, `.env.example:168-171`).
- Reference implementations to copy: `providers/paypal-payouts.provider.ts`,
  `providers/wise.provider.ts` (smallest), `providers/stripe.provider.ts`.

### Surrounding money machinery (reused as-is — do not rebuild)

BIGINT minor units, per-currency `CURRENCY_POLICY`, payout destination
AES-256-GCM encryption + HMAC, payout fence lifecycle
(`initiationPayoutId`, terminal-state-only release, high-value second
approval), payout request unique-per-allocation, advisory locks + CAS +
idempotency keys, audit-inside-transaction. See `AGENTS.md` "Bug classes
fixed" for the invariants any new provider code must preserve.

---

## 2. Workstream W1 — Dodo money-in (deposits)

**Goal:** an advertiser can top up their balance through Dodo checkout, with
the same correctness properties the Stripe path earned (A-062/A-063/A-107).

### W1.1 Payment-processor abstraction for deposit sessions

- Introduce a deposit-session interface (shape: the current
  `{ advertiserId, amountMinor, currency, successUrl, cancelUrl,
idempotencyKey } → { sessionId, url }` contract) and make the advertiser
  controller resolve the **configured processor** instead of `this.stripe`.
- Selection: `DEPOSIT_PROCESSOR=dodo` (env, validated by
  `@waitlayer/config`). Default when unset: **fail closed** — the endpoint
  returns the existing "Deposits are temporarily disabled"/not-configured
  refusal, never a 500 (parity with the `WEB_BASE_URL` guard at
  `advertiser.controller.ts:309-311`).
- Keep the Stripe implementation registered behind the same interface.

### W1.2 `DodoProvider` (deposit side)

- New `apps/api/src/payout/providers/dodo.provider.ts` calling the Dodo API
  (checkout/payment-link creation). **Use `fetch`, not an SDK** — see
  `scripts/audit-dependencies.mjs` and the license/audit gates; every
  dependency added must clear them.
- Config: `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_BASE_URL`
  (test vs live), plus whatever identifiers Dodo requires (brand/product).
  Add to `packages/config` schema **and** `.env.example`, and to
  `scripts/deploy-preflight.mjs` (production must fail closed on missing /
  placeholder creds; test key in production should hard-fail if Dodo
  distinguishes them).
- Readiness: implement `readiness()` so `/health`-adjacent surfaces report
  the rail, and the web billing page fails closed with an explanation
  (pattern: `apps/web/src/lib/payout-readiness.ts`).

### W1.3 Dodo webhook controller + reconciliation

- New `apps/api/src/payout/dodo-webhook.controller.ts` mounted at a public
  route (e.g. `payout/dodo/webhook`), **signature-verified on the raw body**
  per Dodo's current documented scheme (verify against live docs — do not
  assume Stripe's `t=,v1=` format). No signature → 400 + nothing recorded,
  mirroring the A-107 authenticity-boundary tests.
- Event handling must reproduce, against Dodo's event vocabulary:
  - idempotent ledger credit keyed by Dodo's payment id (duplicate delivery
    must be a no-op, both orderings — payment-success duplicate AND
    refund-before-completion catch-up, `stripe-webhook.controller.ts:479-516`);
  - refund/dispute debit with the hold/restore semantics of A-063;
  - deposit-triggered campaign auto-activation (A-019 parity);
  - a `webhook_events`-style durable event log with the same
    processed/failed handling, and a **reclaim cron equivalent** of
    `WebhookReclaimCron` for stalled events.
- **MoR amount semantics (must be decided before coding — §8.5):** Dodo is a
  Merchant of Record. Fees/taxes may mean the platform's remittance ≠ the
  customer-charged amount. The advertiser ledger must credit one consistent
  figure (recommendation: the amount the advertiser was charged, gross;
  platform absorbs MoR fees as COGS). Document the decision in code and in
  `docs/ops/payout-runbook.md`.
- Guard the new public route in the route sweep expectations
  (`AGENTS.md` A-110 keeps a list of deliberately-public endpoints).

### W1.4 Web surface

- Billing page: no structural change expected (it already redirects to the
  returned `url`). Verify Dodo's redirect parameters can express
  success/cancel (else adapt return handling on
  `apps/web/src/app/advertiser/page.tsx:67-81`).
- Stripe Connect return handling exists on
  `apps/web/src/app/developer/payouts/page.tsx:170-178`; with Stripe
  inactive this is dead-but-harmless — leave for W3.5 decision.

### W1.5 Gates (definition of done)

- Unit + contract specs mirroring `stripe-webhook.controller.spec.ts`'s
  authenticity suite: missing/forged signature, raw-body substitution,
  unconfigured Dodo, duplicate delivery, refund ordering. Every test must
  fail when the signature check is removed (the A-107 mutation test).
- Integration spec in the style of `payout-sandbox-run.spec.ts` against Dodo
  **sandbox** credentials (opt-in via env, skipped cleanly when absent).
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; e2e suites
  green via `.e2e/run-e2e.sh` and `pnpm e2e:production`;
  `scripts/scan-build-secrets.mjs`, `scripts/audit-dependencies.mjs`,
  `scripts/check-licenses.mjs` clean.
- Browser e2e: a deposit-journey test against the Dodo sandbox (or, if the
  sandbox cannot be driven headlessly, a content-gate test asserting the
  billing page renders the Dodo rail and fails closed without creds).

---

## 3. Workstream W2 — Dodo money-out (payouts)

**RESOLVED 2026-08-17 (decision D4): W2.B is the branch.** Verified from
Dodo's docs and API index: Dodo's payout surface is read-only and settles
**our** earnings to **our** verified bank account. It cannot pay our
developers, by API or at all. The operator's "use Dodo for payouts too"
intent is therefore satisfied only in the treasury sense: Dodo deposits
accumulate in the WaitLayer wallet (USD/GBP/EUR) and settle to the platform
bank on the configured cycle; developer payouts are then issued from
platform rails.

**Operator duties on the Dodo side (treasury, not code):**

- complete account verification + link the platform bank account
  (`docs.dodopayments.com/miscellaneous/verification-process`);
- choose a payout cycle (default bi-monthly; weekly on request) and note the
  $50 USD minimum threshold and MoR fee/tax deductions when sizing the
  developer payout float — **platform cash-flow timing depends on Dodo's
  settlement cycle, not on when advertisers deposit**.

### W2.B — platform rails for developer payouts (deferred by D5)

- The code keeps `manual` + `paypal_email` available for a future operator
  decision (`packages/shared/src/payout-providers.ts:32-45`, admin-processed),
  but D5 explicitly defers developer payouts and keeps `payouts.requests` and
  `payouts.auto` disabled at launch.
- Revisit `paypal_payouts`/`wise` (both complete, credential-gated) as the
  first automated out-rail later — do not delete them (D2 parity). Before
  enabling the payout switch, run the provider sandbox journey and establish
  reconciliation ownership.
- **Cash-flow note (from D4):** developer payouts leave the platform bank
  that Dodo settles into, on a cycle up to bi-monthly. If a developer's
  earnings hold period expires before Dodo has settled the covering
  deposits, the platform pays from its own float. Size the float
  accordingly or lengthen `holdDays` — an operator decision (§8.11).

### W2.A — Dodo payouts ARE available (REJECTED — kept for the record)

Investigated 2026-08-17 and ruled out: Dodo exposes no payout-creation API,
only `GET /payouts` + breakup/CSV reads, and prohibits third-party payout
accounts. Do not build a `DodoPayoutProvider`. If Dodo ever ships a
third-party payout API, revisit; the integration shape is in git history
here.

---

## 4. Workstream W3 — Stripe deactivation (inactive, not removed)

- Production env carries **no** `STRIPE_*` values; `.env.example` keeps them
  documented with an "inactive at launch (D2)" note.
- Verify fail-closed behaviour of every Stripe surface without creds —
  deposit session creation (must refuse cleanly, not 500), webhook route
  (`payout/stripe/webhook` must reject unverified events — it already
  signature-gates, confirm no unconfigured-crash), `StripeProvider`
  readiness, `WebhookReclaimCron` (must no-op, not crash —
  `WEBHOOK_RECLAIM_CRON` default documented "production may not disable";
  decide: cron skips when Stripe unconfigured).
- `scripts/deploy-preflight.mjs`: fail on **half-configured** Stripe (e.g.
  secret present, webhook secret absent) — that's the accident class.
- Operator: disable any live Stripe webhook endpoints in the Stripe
  dashboard (§8.6) so events stop firing at a rail we don't reconcile.
- Keep all Stripe code, specs and the provider entry in `payout.service.ts`
  intact; `stripe_connect` stays `coming_soon` in the catalogue. Record D2 in
  `AGENTS.md` current-status when this lands.
- Docs: `docs/ops/payout-runbook.md` provider table gains a Dodo row and an
  "inactive" marker for Stripe rails.

---

## 5. Workstream W4 — launch path (payment-adjacent, pre-existing gaps)

Nothing here is new; this is the `AGENTS.md` open-item list intersected with
launch. Order matters — the cold-start sequence is documented in
`docs/ops/deployment-checklist.md` (migrate → env-marker → admin).

1. **Deployment** (open item #3): web on Vercel, API on a container host,
   `api.waitlayer.com` DNS, `NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL` as
   Vercel **build** variables (A-083). Requires §8.7.
2. **Release secrets** (open item #2): `CONTAINER_REGISTRY` + creds,
   staging/production host values, remote Compose `.env`.
3. **Money switches**: `ads.global` ON, `deposits.global` ON (after W1),
   payouts per W2 outcome, **`wait.earnings` OFF** until an independent
   attestation operator exists (open item #1 — see §8.4).
4. **Client distribution**: `CLIENTS_PUBLISHED = false`
   (`apps/web/src/components/developer-get-started.tsx:37`) — flip only when
   the VSIX is on Marketplace and the CLI on npm; the publish workflows
   already gate artifacts.
5. **Admin operation**: bootstrap via `pnpm bootstrap:admin`, TOTP enrolment
   (`/admin/security`), MFA step-up verified — needed for campaign approval
   and every money switch.
6. **Branch protection / CODEOWNERS** (open item #5), **rotate the leaked
   GitHub credential** (open item #6), Google OAuth decision (§8.8), CI
   test-DB consent (open item #10).

---

## 6. Workstream W5 — legal & compliance

- `apps/web/src/app/legal/gdpr-dpa/page.tsx:109` lists sub-processors
  "PayPal, Stripe, Wise, …" — **add Dodo Payments**; decide with counsel
  whether inactive Stripe stays listed (recommend: keep, marked inactive).
- Terms + `payout-policy`: Dodo as Merchant of Record changes who the
  seller of record is and how tax/VAT is handled on advertiser deposits.
  Refund policy must match what Dodo actually executes. Requires §8.10.
- If payouts launch on `manual`: the payout-policy page already describes
  admin-processed rails — verify copy matches the launch reality.

---

## 7. Workstream W6 — deferred / non-blocking (recorded so it is not lost)

- CLI `commands/sandbox.ts` was restored on 2026-08-18 with server-confirmed
  sandbox/test gating, exact bounded XTS amount parsing, and focused command
  tests. VS Code `quiet-hours.ts` remains unported and is still non-blocking.
- TypeScript 7 branch: blocked on typescript-eslint ≥ TS 7.1 support.
- 23 dependabot branches: review post-launch, not before.
- `wait.earnings` attestation operator (open item #1) is the core-value-prop
  gap; it is an external dependency, not code — tracked in §8.4.

---

## 8. Operator input register (blocking answers first)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Blocks                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **Dodo credentials**: ✅ test API key received 2026-08-17 (stored in gitignored envs, `DODO_BASE_URL` set to test). **Still needed:** live API key, and the **webhook signing secret** (Developer → Webhooks in the dashboard) — without it no webhook can be verified (W1.3). Who owns the dashboard?                                                                                                                                                                                                                                                                                                                  | W1.3, launch           |
| 2   | ~~Does Dodo support third-party payouts?~~ **Answered 2026-08-17: no** (D4). **Answered 2026-08-19 by operator (D5):** defer developer payouts until a later automated rail; keep `payouts.requests`/`payouts.auto` OFF at launch. `manual`/`paypal_email` remain available in code but are not the launch operation.                                                                                                                                                                                                                                                                                                   | W2 (closed → deferred) |
| 3   | **Launch countries + currencies** — must be intersected with Dodo's supported set and with `CURRENCY_POLICY` (deposits and campaign budgets are per-currency). Also: create the WaitLayer "wallet top-up" **product** in the Dodo dashboard (test + live) — Dodo checkout is product-based.                                                                                                                                                                                                                                                                                                                             | W1, config             |
| 4   | **wait.earnings**: defer (recommended — no attestation operator exists) or is sourcing one in flight?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | W4.3 scope             |
| 5   | **MoR fee treatment**: platform absorbs Dodo fees/taxes as COGS (recommended) or advertiser credited net? Dodo deducts taxes + platform fees before settlement — the advertiser ledger must credit one consistent figure.                                                                                                                                                                                                                                                                                                                                                                                               | W1.3 ledger semantics  |
| 6   | **Stripe dashboard**: any live webhook endpoints/webhooks to disable? Confirm "inactive, not deleted" (D2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W3                     |
| 7   | **Infra**: where does the API run (host/provider), and who controls DNS for `api.waitlayer.com`? Container registry choice?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | W4.1–4.2               |
| 8   | **Google OAuth**: **answered 2026-08-19 — enable at launch**. Provision matching `GOOGLE_CLIENT_ID` (API) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web/Vercel build); mock Google remains prohibited in production.                                                                                                                                                                                                                                                                                                                                                                                                          | W4.6 credentials       |
| 9   | **Who operates the admin console** (campaign approvals, money switches, manual payout processing — now definitely required per D4)?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | W2.B, W4.5             |
| 10  | **Legal review** of terms/DPA/payout-policy once Dodo copy exists; refund policy decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | W5                     |
| 11  | **Payout float sizing** (new, from D4): developer earnings hold period vs Dodo's settlement cycle (up to bi-monthly) — lengthen `holdDays` or fund a float? **Code side done 2026-08-19:** `PAYOUT_HOLD_DAYS_*` env overrides (new/low_trust 30, normal 14, high_trust 7, extended 60 defaults) are validated in the config schema and honoured by `LedgerMathTrait.getHoldDays` — the operator can now lengthen holds at deploy time with no code change; the restricted/banned −1 "indefinite" contract is not overridable. **Decision still operator-owned:** what values to run in production (vs funding a float). | W2.B                   |

---

## 9. Sequencing

```
W1.1–W1.2 (abstraction + provider)  ──┐
W1.3 (webhook + reconciliation)      ├─ can start immediately, credential-independent
W3 (Stripe fail-closed + preflight) ─┘
        │
        ├─ §8.1–8.3 answered ──► W1.4–W1.5 gates (sandbox creds)
        │                        W2.A or W2.B decision
        │
W4 (deployment) ── after W1 gates + W3; W5 parallel, needs §8.10
```

## 10. Guardrails (read before editing anything)

- Never enable money switches in shared test DBs; integration suites opt in
  via `beforeAll` upserts only (`AGENTS.md` environment rules).
- Never `Number()` arithmetic on money; everything is BIGINT minor units.
- New public webhook route = new unauthenticated surface: signature
  verification is the authenticity boundary — a mock that "gates nothing"
  was exactly the A-107 defect.
- A provider status you cannot read is `processing`, never `failed`.
- Audit events on money paths are `logStrict` **inside** the transaction.
- Prefer `fetch` over adding a Dodo SDK; dependency additions must clear
  `audit-dependencies` + `check-licenses` + `pnpm audit --prod`.
- After any change: re-run the quality gates (`AGENTS.md` §Quality gates) and
  keep `AGENTS.md` current — move finished items to the resolved index with
  the verification command that proves them.
