# Fraud Review Runbook

**Owner:** Admin / Support  
**Frequency:** Daily during beta  
**Scope:** Review and resolve fraud flags before payout processing

---

## 1. Fraud Detection Systems

### Synchronous (blocking)

Triggered at request time; blocked automatically:
- Invalid signatures
- Rate limit exceeded
- Budget exhausted
- Restricted/banned user

### Asynchronous (flagging)

Reviewed in the fraud dashboard:
- High impression velocity
- CTR anomalies
- Shared payout destinations
- Device fingerprint fan-out
- Suspicious wait-state patterns
- New account rapid earning

---

## 2. Daily Review Process

### 2.1 Check the Dashboard

1. Navigate to `/admin/fraud`
2. Review **Fraud Stats** pane:
   - Total open flags
   - Severity breakdown (critical, high, medium, low)
   - Resolution rate and average resolution time
   - Flags by type
3. Filter by severity — process HIGH and CRITICAL first

### 2.2 Review Each Flag

For each flag, open the detail view:

| Data Point | What to Check |
|------------|---------------|
| **User** | Email, trust level, account age, prior flags |
| **Trust score** | Current score and history |
| **Devices** | List of registered devices, fingerprint hashes |
| **Impressions** | Volume trend over time (daily/hourly) |
| **CTR** | Compared to platform average (~0.5-2%) |
| **Payouts** | Payout method, destination, history |
| **Revenue** | Earnings velocity (minor/day since registration) |

### 2.3 Decision Matrix

| Scenario | Likely Verdict | Action |
|----------|---------------|--------|
| CTR > 10% on a new account | Confirmed fraud | Reverse earnings, restrict user |
| Same PayPal on 3+ accounts | Confirmed fraud | Restrict all accounts, flag payouts |
| 1000+ impressions in first day | Investigate | Check device fingerprint; if bot → confirmed |
| Single high-CTR campaign | Investigate | Check if competitor abusing; may be false positive |
| Low trust score + pending payout | Review hold | Do not release payout until resolved |
| Known VPN/datacenter IP | Flag as suspicious | Apply tighter rate limits |
| One-day earning spike then none | Investigate | Check if automated tool was used |

### 2.4 Resolve Flag

1. Click **Resolve**
2. Choose:
   - **Confirmed** — fraud was valid: reverse earnings, apply holds
   - **Invalid** — false positive: release held earnings
3. Add a detailed note explaining the decision

---

## 3. Resolution Effects

### Confirmed (valid fraud)

- Earnings for flagged impressions/clicks are **reversed**
- Advertiser receives **refund** (full bid amount)
- Platform fee and fraud reserve are **debited back**
- If earnings were already **paid**: recovery debit is created
- User trust score **decreases**
- Repeat confirmed fraud → **restrict** or **ban** user

### Invalid (false positive)

- Held earnings are **released** to confirmed
- No financial impact
- User trust score is unaffected

---

## 4. Recovery Debt Workflow

When fraud is confirmed after payout:

1. System creates **confirmed debit** entries in earnings ledger
2. These reduce future payout availability automatically
3. Admin reviews at `/admin/recovery-debt`
4. Options:
   - **Open case** — track the debt with external reference
   - **Mark recovered** — funds were returned externally
   - **Write off** — low amount, not worth pursuing
   - **Close** — case resolved without recovery

---

## 5. Fraud Simulation Tests

Before enabling real payouts, run:

```bash
# Simulate repeated ad requests from one device
# Expect: rate limit triggered, fraud flag created

# Simulate multiple accounts with same payout email
# Expect: duplicate destination fraud flag

# Simulate clicks immediately after render
# Expect: CTR anomaly detection, impression invalidated

# Simulate high-frequency wait-state loop
# Expect: wait-state rate limit, fraud flag
```

---

## 6. Reporting

### Weekly fraud report should include:

- Total flags created and resolved
- Confirmed vs false-positive ratio
- Total earnings reversed (minor)
- Total advertiser refunds (minor)
- Top flag types
- Users restricted/banned

### Metrics targets:

- **Escalation rate** (confirmed / resolved): < 60% is healthy (most flags should be valid)
- **False positive rate** (invalid / resolved): > 40% indicates overly aggressive rules
- **Avg resolution time**: < 48 hours
- **Fraud rate**: < 5% of total impressions

---

## 7. Escalation

- **Legal concern:** Document and consult legal counsel
- **Pattern change:** If new fraud pattern emerges, create a detection rule
- **Large financial exposure:** Immediately restrict user, freeze all pending payouts
