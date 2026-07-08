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
- Creative destination URLs must be public `https://` domain-name URLs without URL credentials, localhost/IP/internal hosts, or deceptive display domains.
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
- Currency-scoped admin recovery-debt cases for debt that cannot be netted against future earnings, including a web operator page, external references, terminal outcomes, audit logs, and a partial unique index preventing duplicate active cases per developer/currency.

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
- Users repeatedly fail to replace a payout destination because inactive historical rows collide with new methods.

Mitigation:

- Automated stub providers fail closed in production before the processing claim.
- PayPal Payouts and Stripe Connect require credentials in production.
- PayPal Payouts validates recipient email and positive amount before any provider network call.
- Payout method creation validates provider-specific destination shape before storage so bad rows cannot sit dormant until payout processing.
- Automated payout provider logs should store only provider ids and hashed recipient references, never raw payout destination PII.
- Stripe Connect payout methods must store a verified connected-account id (`acct_*`) until in-app onboarding is built.
- Enforce one active payout method per user/provider with an active-only partial unique index; retain inactive destination history for audit.
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
- Support recovery tokens are issued unusually often, expire unused, or are used from unexpected authenticated sessions.

Mitigation:

- Store device event secrets only in OS-backed secret stores where available.
- Reject legacy global-HMAC event signatures instead of accepting a shared fallback.
- Allow same-user legacy null-secret rows to re-register and receive a fresh per-device secret.
- Allow same-user same-fingerprint password accounts to rotate a lost local secret only after password re-authentication.
- Allow linked Google accounts to rotate a lost local secret only after matching Google ID-token re-authentication.
- Allow support/admin-issued one-time recovery tokens for non-Google passwordless accounts; store only token hashes, expire them quickly, revoke older unused tokens for the same device, consume them before secret rotation, and audit issuance/rejections.
- CLI and VS Code extension transports reject non-HTTPS remote endpoints before sending bearer/device credentials; only loopback HTTP is allowed for local development.
- Build provider-native re-authentication for future non-Google providers to reduce support-token usage.

Owner: Security/Extension Engineering

## Risk 17: Web session proxy abuse or login CSRF

Impact: high

Likelihood: medium

Signals:

- Cross-origin POST/PATCH/DELETE requests hit same-origin API Route Handlers.
- Login/signup/google endpoints receive unusual Origin/Referer combinations.
- Oversized or chunked request bodies target the Next.js auth/proxy layer before reaching NestJS body limits.
- Browser-visible API responses unexpectedly contain token or secret-shaped fields.

Mitigation:

- Keep auth cookies httpOnly, SameSite=Lax, and Secure in production.
- Reject cross-origin mutating Route Handler requests with Origin/Referer checks.
- Enforce the explicit proxy path allowlist before upstream dispatch.
- Stream auth/proxy request bodies through a 100kb limiter before JSON parsing or forwarding.
- Refuse non-HTTPS remote `NEXT_PUBLIC_API_URL` origins before server-side Route Handlers send cookies or bearer credentials upstream; only loopback HTTP is allowed for local development.
- Strip token and secret fields from same-origin proxy responses as defense in depth.

Owner: Security/Web Engineering

## Risk 18: API-key scopes drift into human-role authorization

Impact: high

Likelihood: medium

Signals:

- API-key requests unexpectedly pass or fail role-gated routes after guard changes.
- Machine-to-machine advertiser calls are rejected because the key owner's human role differs from the scoped advertiser context.
- API-key requests reach support/admin-only endpoints.
- API-key requests create or rebind advertiser profiles instead of staying scoped to an existing advertiser.
- Scope metadata is added to a controller without corresponding API-key guard tests.

Mitigation:

- Evaluate `req.apiKey` before synthesized `req.user` in role checks.
- Deny API-key access to elevated human roles (`admin`, `support`, `super_admin`) regardless of owner role.
- Require explicit `@AllowApiKey()` plus route-level `@RequiredScopes(...)` for API-key-enabled controllers.
- Keep advertiser API keys server-scoped to an owned `advertiserId` and reject generic keys on advertiser routes.
- Reject advertiser profile creation through API keys; profile creation is an interactive JWT user action.
- Require API-key owners to remain `active`; restricted, banned, deleted, or missing owners cannot mint or validate API keys.
- Maintain unit tests for API-key role precedence, elevated-role denial, and scope-less key denial.

Owner: Security/Backend Engineering

## Risk 19: Advertiser destination URLs become phishing or internal-network launch vectors

Impact: high

Likelihood: medium

Signals:

- Approved creatives point to localhost, IP literals, internal hostnames, or plain HTTP destinations.
- `displayDomain` differs from the actual destination hostname.
- Click records do not retain the destination URL shown to the user.
- Old manually imported creatives bypass current DTO validation and continue serving.

Mitigation:

- Enforce public `https://` destination URLs at the API service layer, not only via DTO decorators.
- Reject URL credentials, localhost, IP literals, single-label/internal hostnames, and reserved internal suffixes.
- Require `displayDomain` to match the destination hostname, with only `www.` normalization allowed.
- Derive a truthful display domain when an update changes the destination URL without sending one.
- Filter unsafe legacy creatives out of ad serving before campaign selection.
- Persist the creative destination URL into click records as billing and review evidence.

Owner: Security/Marketplace Engineering

## Risk 20: Restricted accounts continue earning or using long-lived credentials

Impact: high

Likelihood: medium

Signals:

- Restricted users continue receiving ads or creating billable impressions/clicks.
- API keys owned by restricted accounts keep succeeding after account review.
- Support recovery tokens or machine credentials are used after a fraud restriction.
- Ledger entries keep growing for users whose status is no longer active.

Mitigation:

- Freeze normal JWT credential issuance, refresh, and access-token validation for all non-active account statuses.
- Require active account status before serving ads or creating billable impression/click outcomes.
- Require active account status before API-key minting and validation.
- Persist restricted impression qualification as non-billable with an explicit invalidation reason.
- Keep payout and referral reward paths blocked for restricted/banned users.
- Provide any future restricted-account appeal or compliance workflow through an explicit support-reviewed path rather than general app sessions.

Owner: Security/Fraud Engineering
