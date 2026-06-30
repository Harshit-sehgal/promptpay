# Payout Strategy

## Positioning

WaitLayer should be payout-flexible, not payout-magical. The promise is a global-first payout architecture with PayPal-first MVP support and future provider expansion. Marketing must avoid implying that every country and user is immediately payable.

## MVP payout model

Provider: manual PayPal payout flow.

Flow:

1. User adds PayPal email.
2. System validates email format and checks duplicate-risk signals.
3. User earns estimated rewards from qualified impressions.
4. Fraud review window matures eligible earnings to confirmed.
5. Available earnings exclude held, reversed, pending, and already paid entries.
6. User requests payout above threshold.
7. Admin reviews trust score, fraud flags, ledger, account status, payout destination, and amount.
8. Admin pays manually via PayPal.
9. Admin records PayPal transaction ID.
10. System marks payout paid and moves included ledger entries to paid.

Minimum threshold:

- Start at USD 10 for MVP.
- Consider USD 5 only if payment fees and abuse load stay manageable.

## Earnings states

- Estimated: shown after qualified impression but not mature.
- Pending: waiting for review window or aggregation.
- Confirmed: passed review and eligible for availability.
- Held: blocked by fraud, policy, payout, or account review.
- Available: confirmed and not held, reversed, or already paid.
- Requested: included in an open payout request.
- Paid: included in completed payout transaction.
- Reversed: invalid traffic, policy violation, or correction.

## Revenue split

Default MVP split:

- 60% user earnings.
- 30% platform fee.
- 10% fraud/payment reserve.

Launch incentive option:

- 80% user share for first 3 months.
- Fund from reduced platform fee, not from reserve below safety threshold.
- Clearly label as temporary launch pricing.

Recommended beta approach:

- Use 60/30/10 in ledger code.
- Allow campaign-level promotional split through admin config.
- Never hardcode the split inside event handling.

## Payout provider interface

Each provider must support:

- createRecipient.
- validateRecipient.
- createPayout.
- checkPayoutStatus.
- handleWebhook.
- markFailed.
- markCompleted.

Provider implementations:

- ManualProvider: records manual admin payout and external transaction ID.
- PayPalEmailProvider: stores destination email and routes payout to manual flow.
- PayPalPayoutsProvider: later automated API.
- StripeConnectProvider: later for eligible countries.
- PayoneerProvider: later.
- WiseProvider: later.
- RazorpayProvider: later for India where compliant and commercially viable.

## Provider rollout

### Phase 1: Manual PayPal

Purpose:

- Prove payout trust.
- Avoid premature payout automation.
- Learn fraud patterns.
- Support countries that are poorly served by Stripe Connect where PayPal is available.

Limitations:

- Manual operations.
- PayPal account access and compliance approval may vary.
- Fees and reversals need reconciliation.
- Tax reporting still requires professional review.

### Phase 2: PayPal Payouts API

Add when:

- PayPal account is approved for Payouts.
- Manual payout volume exceeds operations threshold.
- Ledger reconciliation is stable.
- Fraud hold system has beta evidence.

Requirements:

- Batch payout idempotency.
- Webhook processing.
- Failed payout retry workflow.
- Fees and currency conversion accounting.
- Provider status reconciliation.

### Phase 3: Stripe Connect

Add when:

- Supported countries and tax onboarding improve conversion for eligible users.
- WaitLayer needs stronger KYC/tax collection through a managed provider.

Rules:

- Do not replace PayPal with Stripe-only.
- Use Connect where it improves compliance and coverage.
- Keep payout provider abstraction intact.

### Phase 4: Regional providers

Potential providers:

- Payoneer for broad marketplace payouts.
- Wise for selected cross-border payouts.
- Razorpay for India if regulatory and tax requirements are satisfied.
- Local bank payout partners for high-volume regions.

## Payout risk controls

- Manual approval for all MVP payouts.
- Longer hold for new users.
- Hold on payout destination reuse.
- Hold on new country/device before payout.
- Hold on high earning velocity.
- Hold on unresolved fraud flags.
- Maximum payout amount for new accounts.
- Admin dual approval for large payouts.
- Audit log for every status change.

## Tax and compliance notes

Before public launch:

- Consult tax counsel on reward classification and reporting.
- Define user responsibility for local taxes in payout policy.
- Decide whether KYC is required before first payout or above threshold.
- Maintain payout records for legal retention period.
- Add sanctions screening where provider coverage requires it.
- Avoid making employment-like income promises.

## User-facing payout copy

Required dashboard concepts:

- "Estimated earnings are not final."
- "Confirmed earnings passed the review window."
- "Available balance is the amount eligible for payout."
- "New accounts may have longer holds."
- "Suspicious or invalid activity can be reversed."
- "Payout availability depends on provider, country, and compliance checks."

## Payout tests

- Payout request cannot include pending earnings.
- Payout request cannot include held earnings.
- Payout request cannot include reversed earnings.
- Payout request below threshold is rejected.
- Duplicate payout request idempotency key returns same request.
- Admin mark-paid requires transaction ID.
- Mark-paid updates payout transaction and ledger atomically.
- Failed payout releases ledger entries back to available or held depending on reason.

