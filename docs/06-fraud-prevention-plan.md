# Fraud Prevention Plan

## Principles

- Fraud prevention starts before the first payout.
- Payout holds are safer than trying to recover paid fraudulent rewards.
- Advertisers must not pay for invalid traffic.
- Honest developers should understand payout status without seeing exploitable thresholds.
- Exact thresholds stay private and configurable.

## Valid impression requirements

An impression is valid only when:

- User is authenticated.
- Device is registered and active.
- Session is active.
- Event signature is valid.
- Campaign is approved, active, funded, and eligible.
- Ad was requested during an eligible wait state.
- Ad was actually rendered.
- Ad remained visible for at least 5 seconds.
- User/device/IP/session are within rate limits.
- Impression token is not duplicate or expired.
- User is not restricted or banned.
- Basic fraud checks pass.

## Valid click requirements

A click is valid only when:

- Prior valid impression exists.
- Click uses same user, device, and session.
- Click occurs after render and within a reasonable time window.
- Repeated clicks are capped.
- User is not clicking own advertiser campaign.
- Timing and frequency do not match automation patterns.
- Impression is not already invalidated.

## Synchronous controls

Run before ad serving or event acceptance:

- Authentication and role check.
- Device status check.
- User status check.
- Payload schema validation.
- Unknown-field rejection.
- Signature verification.
- Idempotency key check.
- Per-user ad request limit.
- Per-device ad request limit.
- Per-IP-hash ad request limit.
- Per-session wait-state limit.
- Per-campaign frequency cap.
- Campaign budget reservation.

## Asynchronous detection rules

### Activity volume

- Too many wait states per hour/day.
- Too many qualified impressions per hour/day.
- Impossibly long active windows.
- High activity across many hours without normal breaks.
- Repeated wait-state start/end loops.

### Device and network

- Many accounts sharing one device fingerprint.
- Many accounts sharing one payout destination.
- Many accounts behind one network hash.
- One account across many network hashes in a short window.
- Sudden country or device changes.
- Known datacenter, proxy, VPN, emulator, or VM signals where legally and technically available.

### Click behavior

- Clicks too fast after render.
- Repeated clicks on same campaign.
- Abnormally high CTR.
- Same user clicking most impressions.
- Clicks without normal wait-state distribution.

### Account risk

- New account earning too quickly.
- Email not verified.
- No stable device history.
- Same PayPal email reused.
- Payout request soon after high earning burst.
- Prior fraud flags.

## Trust score

Initial score: 40.

Positive factors:

- Account age.
- Email verification.
- GitHub verification.
- Device consistency.
- Normal activity pattern.
- Low invalid traffic rate.
- Successful payout history.
- Low report or complaint rate.

Negative factors:

- Fraud flags.
- Abnormal impression volume.
- Suspicious CTR.
- Device or network fan-out.
- Shared payout destination.
- Recent account creation.
- Failed payout identity checks.
- Admin enforcement actions.

Trust levels:

- New: limited earning velocity and longest hold.
- Low trust: tight caps and manual payout review.
- Normal: standard caps and holds.
- High trust: standard review with lower manual friction.
- Restricted: cannot earn or withdraw until review.
- Banned: no earning, no payout, account access limited to appeal/export where required.

## Payout hold rules

MVP defaults:

- New account hold: 30 days.
- Normal hold: 14 days.
- High-trust hold: 7 days.
- Restricted hold: indefinite until review.
- Suspicious event hold: until fraud flag resolved.

Release conditions:

- Review window elapsed.
- No unresolved high-severity fraud flags.
- User not restricted or banned.
- Ledger reconciliation passes.
- Payout destination not linked to abuse.

## Invalid traffic handling

When traffic is invalid:

- Mark impressions and clicks invalid.
- Reverse estimated or confirmed user earnings that are not paid.
- Hold future payout if invalidation affects paid period.
- Credit advertiser ledger.
- Reduce campaign reported billable metrics.
- Record fraud flag and audit action.

If payout already occurred:

- Record recoverable negative ledger balance.
- Restrict account if abuse is confirmed.
- Do not charge future advertisers for the invalid traffic.
- Escalate repeat or material cases to manual review.

## Admin fraud review

Admin fraud queue shows:

- User identity summary.
- Trust score history.
- Device list.
- Network hash patterns.
- Impression and click trends.
- Payout destination reuse.
- Campaigns affected.
- Ledger exposure.
- Recommended action.

Allowed actions:

- Resolve valid.
- Resolve invalid.
- Hold earnings.
- Release earnings.
- Restrict user.
- Ban user.
- Invalidate events.
- Credit advertiser.
- Add note.

All actions must create audit log entries.

## Fraud tests

Required automated tests:

- Replayed impression is ignored.
- Replayed click is ignored.
- Impression below visibility duration is not billable.
- High-frequency wait-state loop creates fraud flag.
- Shared PayPal email creates fraud flag.
- New account high earning creates payout hold.
- CTR anomaly creates fraud flag.
- Restricted user cannot request payout.
- Invalidated impression reverses ledger entries.
- Advertiser credit is created for invalid traffic.

## Fraud simulation for beta

Before beta payout:

- Script repeated ad requests from one device.
- Script repeated qualified impressions with same token.
- Script multiple accounts with same payout email.
- Script clicks immediately after render.
- Simulate device switching and network switching.
- Simulate campaign budget exhaustion race.

Success:

- Obvious abuse is flagged or blocked.
- No double-billing occurs.
- No payout can include held or invalidated earnings.

