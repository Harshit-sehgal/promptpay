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
- Redis-backed production rate limits and brute-force lockouts.
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
- Confirmed `debit` recovery rows for `paidSkipped` fraud reversals so future payouts are reduced automatically.
- Operational review for recovery debt that cannot be netted against future earnings.

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

## Risk 13: Supply-chain or transitive dependency vulnerabilities reach production

Impact: high

Likelihood: medium

Signals:

- `pnpm audit --prod` reports critical or high vulnerabilities.
- Deprecated transitive packages remain in production dependency paths.
- Framework transitive dependencies lag patched versions.

Mitigation:

- Run `pnpm audit --prod` as a release gate.
- Remove unused production dependencies promptly.
- Use narrow workspace overrides for patched transitive versions when upstream packages lag.
- Revisit overrides during framework upgrades so pins do not hide incompatibilities.

Owner: Platform/Security

## Risk 14: Stub payout integrations are used as real providers

Impact: high

Likelihood: medium

Signals:

- Production payout transaction IDs have stub-like prefixes.
- Provider credentials are missing while automated payout methods are enabled.
- Admins process non-manual providers without a PSP confirmation.

Mitigation:

- Automated stub providers fail closed in production before the processing claim.
- PayPal Payouts requires credentials in production.
- Keep manual payout methods explicit and reconcile them through admin review.
- Require provider runbook evidence before enabling each automated PSP.

Owner: Backend/Finance Engineering

## Risk 15: Redis outage disables distributed abuse controls

Impact: high

Likelihood: medium

Signals:

- API startup fails in production because `REDIS_URL` is missing or unreachable.
- Auth and route rate-limit checks return service-unavailable responses.
- Redis latency or connection errors appear in API logs.

Mitigation:

- Require `REDIS_URL` in production configuration.
- Fail closed for production rate limiting and brute-force tracking.
- Run Redis with health checks and operational alerts.
- Keep local/test in-memory fallback only outside production.

Owner: Platform/Security

## Risk 16: Device event secret loss blocks extension traffic

Impact: medium

Likelihood: medium

Signals:

- Devices repeatedly fail event signature verification after reinstall or local secret-store loss.
- Users can authenticate but cannot serve ads because their registered device no longer has its local `eventSecret`.
- Non-Google passwordless/social-login users cannot recover a lost local secret without provider re-auth or support.

Mitigation:

- Store device event secrets only in OS-backed secret stores where available.
- Reject legacy global-HMAC event signatures instead of accepting a shared fallback.
- Allow same-user legacy null-secret rows to re-register and receive a fresh per-device secret.
- Allow same-user same-fingerprint password accounts to rotate a lost local secret only after password re-authentication.
- Allow linked Google accounts to rotate a lost local secret only after matching Google ID-token re-authentication.
- Build provider re-auth or support recovery for future non-Google provider accounts.

Owner: Security/Extension Engineering
