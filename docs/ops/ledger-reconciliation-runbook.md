# Ledger Reconciliation Runbook

**Owner:** Admin / Finance  
**Frequency:** Weekly during beta, monthly post-launch  
**Scope:** Verify ledger balances match expected money movement

---

## 1. Ledger Architecture

### Three-Ledger System

| Ledger | Tracks | Entry Types |
|--------|--------|-------------|
| **EarningsLedger** | Developer earnings | `credit` (earnings), `debit` (recovery debt) |
| **AdvertiserLedger** | Advertiser charges | `debit` (spend), `refund` (reversal), `credit` (deposit) |
| **PlatformLedger** | Platform revenue | `credit` (fees), `reversal` (refunds), `refund` (cash out) |

### Entry States

```
estimated → pending → confirmed → paid
                      → held → confirmed (release)
                      → reversed
                      → void
```

### Revenue Split (per billable impression/click)

| Bucket | Share | Ledger |
|--------|-------|--------|
| Developer | 60% (80% launch incentive) | EarningsLedger |
| Platform fee | 30% (10% launch) | PlatformLedger |
| Fraud reserve | 10% | PlatformLedger |

---

## 2. Reconciliation Procedure

### 2.1 Navigate to Admin Ledger

1. Open `/admin/ledger`
2. View **Platform breakdown** for aggregate totals
3. Use filters to examine individual ledger kinds

### 2.2 Verify Invariant: Spend = Earnings + Fees + Reserve

For any time period, the following must hold:

```
Sum(AdvertiserLedger debits) - Sum(AdvertiserLedger refunds)
  = Sum(EarningsLedger credits) - Sum(EarningsLedger debits)
    + Sum(PlatformLedger credits - PlatformLedger reversals)
```

### 2.3 Check Each Ledger Kind

#### EarningsLedger

- `credit` entries by status: estimated + pending + confirmed + held + paid + reversed
- Total credits should roughly equal 60% of total advertiser spend (varies with launch split)
- Recovery debits should never exceed total confirmed credits per user

#### AdvertiserLedger

- `debit` entries = total campaign spend charged
- `refund` entries = invalid traffic reversals + archive refunds
- Net = gross spend - refunds = actual advertiser cost
- `credit` entries = Stripe deposit amounts (linked to Stripe PI)

#### PlatformLedger

- `platform_fee` bucket = 30% of net spend (or 10% with launch split)
- `fraud_reserve` bucket = 10% of net spend
- `cash` bucket = Stripe payouts (outbound cash)
- `referral_bonus` bucket = $5 referral rewards

### 2.4 Manual Cross-Checks

1. Export Stripe transaction report from Stripe dashboard
2. Compare Stripe deposits against `AdvertiserLedger credit` entries
3. Export PayPal transaction report
4. Compare PayPal payouts against `EarningsLedger paid` entries
5. Check that `PlatformLedger cash` debits match PayPal + Stripe Connect outflows

---

## 3. Automated Checks

The **Admin Metrics Dashboard** (`/admin/metrics`) provides:

- Total estimated earnings vs advertiser spend (should be ~60/30/10 split)
- Paid-out amounts vs pending payouts
- Platform fee + reserve totals
- Daily revenue trend charts

Use these as a first-pass health check before diving into raw ledger data.

---

## 4. Common Discrepancies

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Earnings > 60% of spend | Launch incentive active (80% split) | Verify `LAUNCH_SPLIT_ENABLED` config |
| Platform fee + reserve ≠ 40% | Reversals reduced net spend | Check reversal entries |
| Advertiser refunds > 5% of spend | High fraud reversal rate | Review fraud dashboard |
| EarningsLedger debits present | Recovery debt from post-payout fraud | Review `/admin/recovery-debt` |
| Ledger doesn't balance | In-flight entries (estimated not yet confirmed) | Wait for maturation cycle |
| Duplicate entries | Missing or broken idempotency | Check for P2002 errors in logs |

---

## 5. Maturation Cycle

The `LedgerCronService` runs every 10 minutes and:

1. Finds `estimated` earnings where `availableAt <= now()`
2. Flips them to `confirmed`
3. Logs the count of matured entries

**Hold periods by trust level:**
- `new` / `low_trust`: 30 days
- `normal`: 14 days
- `high_trust`: 7 days
- `restricted` / `banned`: indefinite (never matures)

---

## 6. Manual Correction Protocol

If a discrepancy is confirmed:

1. **Do not** directly mutate ledger tables
2. Create compensating entries through the API:
   - Reversals for invalid traffic → use `reverseEarnings` in `LedgerService`
   - Advertiser credits → use platform refund path
   - Recovery debt → system-generated through fraud resolution
3. Record the correction in the audit log
4. Document the root cause and any code fix needed

---

## 7. Reporting

### Weekly reconciliation report:

```text
Period: YYYY-MM-DD to YYYY-MM-DD

ADVERTISER
  Gross spend: $X,XXX.XX
  Refunds: $X,XXX.XX
  Net spend: $X,XXX.XX

DEVELOPER
  Estimated earnings: $X,XXX.XX
  Confirmed earnings: $X,XXX.XX
  Paid out: $X,XXX.XX
  Recovery debits: $X,XXX.XX

PLATFORM
  Platform fees: $X,XXX.XX
  Fraud reserve: $X,XXX.XX
  Referral bonuses: $X,XXX.XX

RECONCILIATION
  Net spend = earnings + fees + reserve? YES/NO
  Stripe deposits match advertiser credits? YES/NO
  PayPal payouts match paid earnings? YES/NO
  Discrepancies found: N
```

### Sign-off

Reconciliation should be signed off by at least one team member not involved in
the daily payout processing to ensure independent verification.
