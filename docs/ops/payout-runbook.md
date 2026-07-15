# Payout Runbook

**Owner:** Admin  
**Frequency:** As payout requests arrive  
**Scope:** Private beta (Phase 6) — all payouts are manually processed

---

## 1. Payout Lifecycle

```
requested → under_review → approved → processing → paid
                                          → failed (provider error)
                    → rejected (admin)
                    → cancelled (user)
```

The **PayoutCronService** automatically polls `processing` payouts every 10 minutes.
For PayPal Payouts API and Stripe Connect, it checks provider status and
auto-completes `paid` or `failed`. Manual PayPal payouts require admin action.

---

## 2. Daily Review Process

### 2.1 Check the Queue

1. Navigate to `/admin/payouts`
2. Review payouts with status `requested` or `under_review`
3. Sort by `createdAt` ascending

### 2.2 Review Each Payout

For each payout request, verify:

| Check                     | What to Look For                                 | Action if Failed               |
| ------------------------- | ------------------------------------------------ | ------------------------------ |
| **User status**           | Not restricted or banned                         | Reject                         |
| **Trust score**           | Not `low_trust` or `new` with excessive velocity | Flag for fraud review          |
| **Fraud flags**           | No unresolved HIGH/CRITICAL flags                | Hold payout                    |
| **Payout method**         | Active and verified                              | Ask user to add method         |
| **Amount**                | Above $10 minimum threshold                      | Reject (below minimum)         |
| **Ledger**                | Available balance ≥ requested amount             | Investigate ledger discrepancy |
| **Duplicate destination** | No other users sharing this PayPal email         | Flag for fraud review          |

### 2.3 Approve or Reject

- **Approve:** Sets status to `approved`. The PayoutCronService or admin action moves it to `processing` then `paid`.
- **Reject:** Releases allocations back to available balance. User can re-request.
- **Partial approve:** Enter a lower `approvedAmountMinor` to pay less than requested.

### 2.4 Mark as Paid (Manual PayPal)

For manual PayPal payouts:

1. Process the payment through PayPal's website/interface
2. Record the PayPal transaction ID
3. In the admin dashboard, click **Mark Paid**
4. Enter:
   - `providerTxId`: The PayPal transaction ID (e.g., `6NW12345XXX`)
   - `amountMinor`: Amount paid in cents (cross-checked against approved amount)
   - `currency`: Currency code (default: `USD`)
5. The system atomically:
   - Flips payout status to `paid`
   - Marks all allocated earnings entries as `paid`
   - Triggers referral reward processing

---

## 3. Automated Payout Completion

### PayPal Payouts API

When `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are configured:

1. Admin approves payout → status `approved`
2. Processing initiates via `processPayout` → status `processing`
3. **PayoutCronService** polls every 10 min:
   - Calls PayPal API `checkStatus(providerTxId)`
   - If `paid`: auto-marks payout as paid
   - If `failed`: marks payout as failed, releases allocations
4. No webhook needed — polling covers PayPal's eventual consistency

### Stripe Connect

1. Admin approves payout → status `approved`
2. Processing initiates → status `processing`
3. **PayoutCronService** polls via Stripe API
4. Stripe webhook also handles `payout.paid`/`payout.failed` as fallback

---

## 4. Troubleshooting

| Symptom                               | Likely Cause                                  | Resolution                                                      |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| Payout stuck in `processing` > 30 min | Provider API timeout or error                 | Check PayoutCronService logs; manually check provider dashboard |
| PayoutCronService error               | DB connection lost or provider config missing | Check `SENTRY_DSN` for error logs; verify provider env vars     |
| Ledger not updating after mark-paid   | Race condition or unique constraint           | Check `payoutTransaction` table for duplicate; retry            |
| Referral reward not processing        | Missing referral link                         | Check `ReferralReward` table for the payout                     |
| PayPal email invalid                  | User entered wrong email                      | Reject payout; ask user to update method                        |

---

## 5. Reconciliation

At least weekly during beta:

1. Export payout history from `/admin/payouts`
2. Cross-reference with PayPal transaction report
3. Verify total `paid` in ledger matches PayPal outflows
4. Check for any `processing` payouts older than 1 hour
5. Run `pnpm audit --prod` to verify no new dependency vulnerabilities

---

## 6. Escalation

- **Large payout (>$500):** Require second admin approval
- **Suspicious pattern:** Flag user for fraud review; hold all pending payouts
- **Payment sent but not reflected:** Contact developer and admin; manual ledger correction

---

## 7. Emergency Freeze (Kill Switch)

Use when a payout destination is confirmed or highly suspected to be compromised, linked to fraud, or subject to compliance blocks. The kill switch halts all outbound flow for the account without deleting it.

### 7.1 Trigger Freeze

1. Retrieve the developer's payout account ID from the admin UI (or `payoutAccount.id` in the database for the user in question).
2. `POST /api/v1/admin/payout-accounts/{id}/freeze` with body `{ "reason": "<operator note for the audit trail>" }`. Requires admin / support / super_admin role.
3. The system writes an `audit_logs` row (`action: payout_account_frozen`, `beforeSnap` includes `isFrozen`, `isVerified`, `provider`, `destination`, `userEmail` for the full pre-state forensic trail; `afterSnap.isFrozen = true`).
4. **Developer-visible effect:** any future `POST /payout/request` using this account immediately fails with `403 Forbidden ("Payout destination is frozen by operator")`. Enforced server-side in `apps/api/src/payout/payout-request.trait.ts:301` regardless of the destination's `isVerified` / `isActive` status.
5. **The developer IS notified by email** — `admin-payouts.trait.ts` fires `EmailQueueService.sendPayoutAccountFrozenAlert` (best-effort, with retry-queue on transient failure) right after the audit log. The email includes provider, destination (email destinations are masked to first-3 + `***@domain`; Stripe `acct_*` and manual references are shown in full), currency, actorRole, optional `reason`, and the freeze timestamp. Failures are tolerated — see `emailQueueService.sendPayoutAccountFrozenAlert(...)` for the console-user behaviour in dev (the email body is logged at INFO).

### 7.2 Lift Freeze

1. After verifying the situation (cleared compliance check, user identified via support, etc.), unfreeze via `POST /api/v1/admin/payout-accounts/{id}/unfreeze` with body `{ "reason": "<note>" }`.
2. The system writes `payout_account_unfrozen` to `audit_logs` and flips `isFrozen = false`. The developer can immediately resume requesting payouts.

### 7.3 Idempotency

Both endpoints are **non-idempotent by design** — re-freezing an already-frozen account (or unfreezing a non-frozen one) returns `409 Conflict` so admins see the duplicate state. This matches the strict state-machine guards on `approvePayout` / `rejectPayout` and prevents silent double-actions. There is no `freeze_noop` audit entry; the conflict path is `audit.log`-free because no state changed.
