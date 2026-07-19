# Operational Runbooks (P1.26)

Executable procedures for incident response and routine operations. Every
runbook lists: **Purpose**, **Preconditions**, **Steps**, **Verification**,
**Rollback**, and **Approvals required**.

Conventions:

- `:5432` is the live Postgres; `:5433` is the isolated test DB. Never run
  `migrate deploy` / `db push` against production without the staging gate
  (P1.23).
- `curl` examples assume an admin `Authorization: Bearer <ADMIN_JWT>` header.
  Replace `<APP>` with the API base URL (e.g. `https://api.waitlayer.com`).
- Runtime kill-switches use `POST /admin/runtime-config/:key` with
  `{ "enabled": false }`. The `:key` value MUST match a key in the
  `RuntimeConfigKey` enum (`packages/shared/src/enums.ts` / the
  `runtime-config` service). Confirm the exact key before flipping it.
- All mutating admin actions emit an immutable `AuditService` row (fail-closed
  inside the transaction). Check `/admin/audit-outbox/dead-letter` after any
  operation.

---

## 1. Pause all ads

**Purpose:** Stop all ad selection/serving immediately (incident, spend leak,
detector runaway).

**Preconditions:** Admin JWT with `admin`/`super_admin`.

**Steps:**

```bash
curl -X POST "<APP>/admin/runtime-config/ads_enabled" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

**Verification:**

```bash
curl "<APP>/admin/runtime-config/ads_enabled" -H "Authorization: Bearer $ADMIN_JWT"
# => { "enabled": false }
```

Confirm no new `ad_requests` counter increments in `/observability/metrics`.

**Rollback:** repeat with `{ "enabled": true }`.

**Approvals:** On-call SRE + one admin.

---

## 2. Pause one currency

**Purpose:** Stop serving/spending for a single currency (e.g. JPY payout
outage, FX feed broken).

**Steps:** Set the currency-specific kill switch (e.g. `ads_currency:JPY`) the
same way as runbook 1. Confirm the key exists in `RuntimeConfigKey`.

**Verification:** `/observability/metrics` `ad_served{currency=JPY}` stops
incrementing; `GET /admin/money-integrity` shows no new JPY spend.

**Rollback:** re-enable the key.

**Approvals:** On-call SRE + one admin.

---

## 3. Pause one provider

**Purpose:** Stop payouts/processing for one PSP (Stripe Connect / PayPal
Payouts down).

**Steps:** Disable the provider via the payout-provider runtime config key
(e.g. `payout_provider:stripe_connect`). Do NOT delete the provider config.

**Verification:** `GET /admin/payout-accounts/fenced` and
`/observability/metrics` `provider_breaker_open{provider=stripe_connect}` quiet
down; no new `processing` payouts for that provider.

**Rollback:** re-enable the key.

**Approvals:** On-call SRE + finance operator.

---

## 4. Freeze payout account

**Purpose:** Block a developer's payouts while investigating fraud / KYC / a
leaked destination.

**Preconditions:** The account may already carry an `initiationPayoutId` fence;
see runbook 6.

**Steps:**

```bash
curl -X POST "<APP>/admin/payout-accounts/<ACCOUNT_ID>/freeze" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Suspected fraudulent destination — investigation #<ID>"}'
```

Freezing while a payout is `processing` (ambiguous initiation) is rejected with
`409` — reconcile via runbook 6 first.

**Verification:** `GET /admin/payout-accounts/<ACCOUNT_ID>` shows `isFrozen: true`.
The developer's subsequent `requestPayout` returns `403` regardless of
`isVerified`/`isActive`.

**Rollback:** `POST /admin/payout-accounts/<ACCOUNT_ID>/unfreeze` with a reason.

**Approvals:** Admin + second-person approval for non-trivial amounts (see
`admin-payouts.trait.ts` freeze policy).

---

## 5. Reconcile ambiguous payout

**Purpose:** Resolve a payout stuck in `processing` where the provider outcome
is unknown (network timeout, webhook lost).

**Steps:**

1. Inspect the payout and its provider transaction:
   ```bash
   curl "<APP>/admin/payouts/<PAYOUT_ID>" -H "Authorization: Bearer $ADMIN_JWT"
   ```
2. Query the provider out-of-band using the stored `providerTxId` / external
   reference.
3. If the provider confirms **paid**: `POST /admin/payouts/<PAYOUT_ID>/mark-paid`
   with the provider transaction id. The service re-validates amount/currency/
   account/provider before flipping to `paid`.
4. If the provider confirms **failed**: `POST /admin/payouts/<PAYOUT_ID>/mark-failed`.
5. If still unknown: leave it `processing`; the reconciliation worker
   (P1.10 / `PayoutCronService`) will keep polling and alert after the age
   threshold.

**Verification:** `GET /admin/payouts/<PAYOUT_ID>` shows terminal status and the
ledger allocations reflect the outcome. No `alert{event=ambiguous_payout_outcome}`
remains.

**Rollback:** N/A — terminal transitions are one-way by design.

**Approvals:** Admin + finance operator.

---

## 6. Release payout fence

**Purpose:** Clear a durable `initiationPayoutId` fence for a payout account
after the referenced payout reaches a terminal/reconcilable state.

**Preconditions:** The referenced payout MUST be in `paid`, `failed`,
`rejected`, or `cancelled`. Releasing while `processing` is rejected (400).

**Steps:**

```bash
curl -X POST "<APP>/admin/payout-accounts/<ACCOUNT_ID>/release-fence" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Provider confirmed failure via out-of-band check #<ID>",
    "providerTxId": "pp_tx_abc",
    "resolution": "Marked failed; fence cleared for retry"
  }'
```

Optional `step-up` (MFA) is enforced by `AdminMfaStepUpGuard` on admin routes.

**Verification:** `GET /admin/payout-accounts/fenced` no longer lists the
account; `GET /admin/payout-accounts/<ACCOUNT_ID>` shows `initiationPayoutId: null`.
An immutable `payout_account_fence_released` audit row exists.

**Rollback:** N/A — re-freeze via runbook 4 if needed.

**Approvals:** Admin + second-person approval for high values.

---

## 7. Repair campaign reservation drift

**Purpose:** Fix a campaign whose reserved budget no longer matches live
impressions (crash mid-reservation, double-spend).

**Steps:**

1. Identify drift: `GET /admin/money-integrity` → `campaignDiscrepancies`.
2. If a single campaign is off, inspect its ledger vs `budgetSpentMinor`:
   ```bash
   curl "<APP>/admin/campaigns/<CAMPAIGN_ID>/ledger" -H "Authorization: Bearer $ADMIN_JWT"
   ```
3. The `campaign-reservation-reclaim.cron` auto-reclaims expired reservations;
   wait one reclaim cycle (or trigger manually in staging) and re-check
   `GET /admin/money-integrity`.
4. For unreconciled drift, open a recovery-debt case:
   `POST /admin/recovery-debt-cases` (see `OpenRecoveryDebtCaseDto`).

**Verification:** `GET /admin/money-integrity` returns `status: healthy` for that
campaign (diff = 0).

**Rollback:** The discrepancy audit row is retained; re-open if needed.

**Approvals:** Admin + finance operator.

---

## 8. Restore database backup

**Purpose:** Recover from corruption / bad migration / deleted data.

**Preconditions:** A verified recent `pg_dump` exists (see runbook 14).

**Steps:**

```bash
# 1. Take a fresh backup of the current (broken) state for forensics
pg_dump "$DATABASE_URL" > "forensics-$(date -u +%Y%m%dT%H%M%SZ).sql"
# 2. Restore the last known-good dump into a temp DB and smoke-test it
createdb waitlayer_restore
psql "$RESTORE_URL" -f "good-<TIMESTAMP>.sql"
# 3. Repoint the app at the restored DB (env: DATABASE_URL) and migrate
pnpm --filter @waitlayer/db exec prisma migrate deploy
# 4. Boot the app, run GET /health/ready, then shift traffic.
```

**Verification:** `GET /health/ready` → `database: connected`;
`GET /admin/money-integrity` → `status: healthy`; integration smoke test green.

**Rollback:** Repoint `DATABASE_URL` back to the forensic dump.

**Approvals:** DBA + on-call lead + product owner (data-loss window).

---

## 9. Roll back application

**Purpose:** A bad deploy is causing errors / money drift.

**Steps:**

```bash
# Identify last-good image digest / git SHA
git log --oneline -10
# Redeploy previous image (Docker / k8s / your orchestrator)
kubectl rollout undo deployment/waitlayer-api   # or pin the previous tag
```

For the **web/BFF**, redeploy the prior `@waitlayer/web` image.

**Verification:** `GET /health/ready` (api) and `GET /` (web) respond;
`/observability/metrics` error rate returns to baseline.

**Rollback:** Redeploy forward once fixed.

**Approvals:** On-call lead.

---

## 10. Roll forward failed migration

**Purpose:** A migration applied partially or failed; the schema is behind.

**Steps:**

```bash
# Check applied state
pnpm --filter @waitlayer/db exec prisma migrate status
# If a migration is marked failed but the schema change actually landed:
pnpm --filter @waitlayer/db exec prisma migrate resolve --applied <migration_name>
# If it did NOT land, re-run deploy (idempotent for NOT VALID / safe DDL):
pnpm --filter @waitlayer/db exec prisma migrate deploy
```

**Verification:** `prisma migrate status` → "all migrations applied";
`GET /health/ready` → `database: connected`.

**Rollback:** If the DDL caused data issues, use runbook 8.

**Approvals:** DBA + on-call lead. **Never** run migrations directly against
production outside the staging gate (P1.23).

---

## 11. Rotate JWT keys

**Purpose:** Suspected JWT signing-key compromise / routine rotation.

**Steps:**

1. Generate a new key and set `JWT_KEY_ID` to the new id; keep the old key in
   the active set (`jwt-keys.ts` supports multiple active ids for overlap).
2. Deploy. Old tokens remain valid during overlap; new tokens use the new id.
3. After the overlap window (e.g. max token TTL), remove the old key id from
   the active set and deploy.

**Verification:** New logins produce tokens with the new `kid`;
`GET /auth/me` works for both old and new tokens during overlap.

**Rollback:** Re-add the old key id to the active set.

**Approvals:** Security lead + on-call lead.

---

## 12. Revoke API keys

**Purpose:** A leaked/abused developer API key.

**Steps:** Revoke via the developer API-key management endpoint
(`POST /developer/api-keys/:id/revoke` — confirm exact path in
`developer.controller.ts`):

```bash
curl -X POST "<APP>/developer/api-keys/<KEY_ID>/revoke" \
  -H "Authorization: Bearer $DEV_JWT"
```

For a key whose owner JWT is unavailable, an admin can disable it through the
admin key-management route (confirm in `admin.controller.ts`).

**Verification:** Requests using the revoked key return `401`; the key no longer
appears in `GET /developer/api-keys`.

**Rollback:** Issue a new key; old revocation is one-way by design.

**Approvals:** Key owner (self-revoke) or admin for forced revocation.

---

## 13. Respond to leaked signing secret

**Purpose:** `JWT_SECRET` / session secret / webhook secret exposed.

**Steps:**

1. Rotate the secret immediately (runbook 11 for JWT).
2. For webhook secrets, rotate in the provider console and update the env var;
   redeploy.
3. Audit recent `audit_dead_letter` and `auth` events for abuse.
4. If a payout provider secret leaked, pause that provider (runbook 3) and
   rotate in the PSP console.

**Verification:** `GET /observability/metrics` shows no new
`alert{event=auth_identity_mismatch}`; old signatures rejected.

**Rollback:** N/A.

**Approvals:** Security lead + on-call lead + legal (if PII exposed).

---

## 14. Investigate ledger discrepancy

**Purpose:** `GET /admin/money-integrity` (or `alert{event=ledger_discrepancy}`)
reports drift.

**Steps:**

1. Open the discrepancy: `GET /admin/money-integrity` → `campaignDiscrepancies`,
   `negativeDeveloperBalances`, `globalReconciliationByCurrency`.
2. For a campaign diff, follow runbook 7.
3. For a negative developer balance, freeze the account (runbook 4) and open a
   recovery-debt case.
4. For a global reconciliation diff, inspect the platform/reserve ledgers and
   open a fraud investigation if unexplained.

**Verification:** `GET /admin/money-integrity` → `status: healthy`; the
`money_integrity_discrepancy` audit row captures the resolved state.

**Rollback:** N/A — read-only reconciliation; corrections go through ledgers.

**Approvals:** Finance operator + admin.

---

## 15. Disable a detector version

**Purpose:** A bad wait-detector release spikes false positives (P1.17).

**Steps:** Kill-switch the detector version via the runtime config key
(e.g. `detector:1.0.0`):

```bash
curl -X POST "<APP>/admin/runtime-config/detector:1.0.0" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"enabled": false}'
```

Tool-specific enable/disable switches use the same mechanism
(`ToggleToolIntegrationDto`, `POST /admin/tools/:tool/integration`).

**Verification:** `GET /observability/metrics` `detector_version{version=1.0.0}`
stops incrementing; false-positive rate (`false_positives`) drops.

**Rollback:** re-enable the key (no extension update required).

**Approvals:** On-call SRE + product.
