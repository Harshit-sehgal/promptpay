# ADR 0002: Three-Ledger Double-Entry Accounting

- **Status:** Accepted (2026)
- **Deciders:** WaitLayer engineering

## Context

A reward marketplace moves money between three parties on every event: the
developer who earned it, the advertiser who paid for attention, and the
platform that operates the marketplace (fee + fraud reserve). We needed a model
that is auditable, supports holds/chargebacks, and makes fraud recovery
possible without corrupting historical balances.

## Decision

Use **three independent ledgers**, each append-only:

- `EarningsLedger` (developer) — `estimated → confirmed → paid`
- `AdvertiserLedger` — debits (spend) and credits (deposits/refunds)
- `PlatformLedger` — fee, fraud reserve, referral bonus, cash

Every qualified impression/click writes **one transaction** that touches all
three ledgers atomically (`$transaction`). Revenue splits 60/30/10
(developer / platform-fee / fraud-reserve), with an 80/10/10 launch split.
DB-level `CHECK (amountMinor >= 0)` constraints enforce non-negative balances.

## Consequences

- **Positive:** Full audit trail; holds and paid-fraud recovery debits are
  first-class; reconciliation is a matter of summing entries.
- **Negative:** More tables to reason about; maturity cron required to flip
  `estimated → confirmed`. Accepted as the cost of integrity in a financial app.
