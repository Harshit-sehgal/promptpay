# Risk Register

## Risk 1: Developers do not want ads in tools

Impact: high

Likelihood: medium

Signals:

- Low opt-in rate.
- High uninstall rate.
- High disable rate.
- Negative feedback about workflow intrusion.

Mitigation:

- Opt-in only.
- Non-intrusive display.
- Category controls.
- Quiet mode.
- Easy disable and uninstall.
- Transparent earnings.
- Run extension tolerance test before scaling.

Owner: Product

## Risk 2: Advertisers do not see ROI

Impact: high

Likelihood: medium

Signals:

- Low repeat spend.
- Low CTR.
- Weak conversion feedback.
- High invalid traffic credits.

Mitigation:

- Start with developer-tool advertisers.
- Provide clear reports.
- Add UTM guidance.
- Improve targeting.
- Use invalid-traffic protection.
- Interview advertisers before self-serve launch.

Owner: Growth/Product

## Risk 3: Fraud becomes too high

Impact: high

Likelihood: high

Signals:

- High suspicious traffic.
- Many duplicate payout destinations.
- New accounts earning too fast.
- CTR anomalies.

Mitigation:

- Payout holds.
- Trust score.
- Rate limits.
- Fraud flags.
- Manual payout approval.
- Invalid traffic credits.
- Fraud simulation before beta.

Owner: Security/Backend

## Risk 4: Payout providers restrict access

Impact: high

Likelihood: medium

Signals:

- PayPal Payouts application rejected.
- Stripe Connect country coverage limits signups.
- Provider terms conflict with reward model.

Mitigation:

- Start manual PayPal.
- Keep provider abstraction.
- Add regional providers in phases.
- Avoid universal payout claims.
- Consult payout-provider terms before automation.

Owner: Finance/Platform

## Risk 5: Product feels shady

Impact: high

Likelihood: medium

Signals:

- Privacy concerns.
- Low advertiser approval.
- Poor press/social reaction.
- Users distrust earnings.

Mitigation:

- Professional branding.
- Clear policies.
- Open-source or auditable client.
- No code/prompt/completion collection.
- Clear ad labels.
- Transparent ledger states.
- Manual advertiser approval.

Owner: Product/Brand

## Risk 6: Legal and tax complexity grows

Impact: high

Likelihood: high

Signals:

- Cross-border payouts increase.
- Tax reporting questions.
- User disputes.
- Region-specific payout restrictions.

Mitigation:

- Start in limited regions if needed.
- Maintain payout records.
- Add tax policy.
- Consult professionals before scale.
- Provider-specific compliance review.

Owner: Legal/Finance

## Risk 7: Tool integrations are brittle

Impact: medium

Likelihood: high

Signals:

- Extensions break after tool updates.
- Wait-state detection is unreliable.
- Users report irrelevant ad timing.

Mitigation:

- Start with VS Code and CLI only.
- Keep integration adapter interfaces.
- Add version gates.
- Monitor event quality by tool version.
- Ship conservative detection.

Owner: Extension Engineering

## Risk 8: Campaign quality damages trust

Impact: high

Likelihood: medium

Signals:

- Many ad reports.
- Scammy advertisers submit campaigns.
- Landing pages change after approval.

Mitigation:

- Manual campaign approval.
- Prohibited categories.
- Landing page checks.
- User report flow.
- Admin pause controls.
- Periodic landing page rechecks.

Owner: Marketplace Operations

## Risk 9: Ledger bugs create financial loss

Impact: high

Likelihood: medium

Signals:

- Ledger does not reconcile.
- Duplicate billing.
- Negative campaign budgets.
- Payout mismatch.

Mitigation:

- Append-only ledger.
- Idempotency keys.
- Transactional budget reservations.
- Ledger tests.
- Reconciliation jobs.
- Manual payout review.

Owner: Backend/Finance Engineering

## Risk 10: Privacy implementation drifts from promise

Impact: high

Likelihood: medium

Signals:

- New telemetry fields added without review.
- Logs contain payload data.
- Error monitoring captures private data.

Mitigation:

- Unknown-field rejection.
- Prohibited field tests.
- Telemetry review checklist.
- Redacted logs.
- Client event builder has no content fields.

Owner: Security/Privacy

## Risk 11: Unit economics do not work

Impact: high

Likelihood: medium

Signals:

- Payout fees consume reserve.
- CPM too low to motivate developers.
- Fraud reserve too small.
- Advertiser acquisition cost too high.

Mitigation:

- Model revenue split scenarios.
- Start with manual payouts and threshold.
- Track fee percentage.
- Adjust reserve.
- Target high-intent developer-tool advertisers.

Owner: Finance/Product

## Risk 12: Competitors copy PayPal support

Impact: medium

Likelihood: high

Signals:

- Competitor adds PayPal or local payouts.

Mitigation:

- Build moat in trust, fraud, reporting, privacy, integrations, and advertiser ROI.
- Do not rely on PayPal as only differentiator.

Owner: Strategy

