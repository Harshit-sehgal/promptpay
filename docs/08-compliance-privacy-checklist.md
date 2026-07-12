# Compliance and Privacy Checklist

This checklist is a product and engineering planning artifact, not legal advice. Legal counsel should review terms, privacy, payout, tax, sanctions, and advertiser policy before public launch.

## Ad labeling

- [ ] Every ad is labeled "Ad" or "Sponsored."
- [ ] The label appears before the advertiser name or message.
- [ ] Label is visible in VS Code, terminal, dashboard previews, and reports.
- [ ] No ad opens a page without a user click.
- [ ] No autoplay sound, deceptive UI, or blocking modal behavior.
- [ ] Sponsored content is visually distinct from system status messages.
- [ ] Campaign preview shows the exact user-facing ad label.

## Opt-in and user control

- [ ] Ads are off until the user opts in during onboarding or extension setup.
- [ ] User can disable ads from extension settings.
- [ ] User can disable ads from dashboard settings.
- [ ] User can set quiet mode.
- [ ] User can set max ads per hour.
- [ ] User can choose or block categories.
- [ ] User can report an ad.
- [ ] User can uninstall extension without account penalty.

## Prohibited data collection

WaitLayer must not collect these by default:

- [ ] Source code.
- [ ] File contents.
- [ ] File names.
- [ ] Private prompts.
- [ ] AI completions.
- [ ] Clipboard contents.
- [ ] Terminal command contents.
- [ ] Repository contents.
- [ ] Project names.
- [ ] Environment variable values.

Engineering controls:

- [ ] Extension event schemas have no fields for prohibited data.
- [ ] API rejects unknown fields on extension and CLI endpoints.
- [ ] Tests assert prohibited fields cannot be serialized.
- [ ] Logs redact request bodies for extension endpoints.
- [ ] Error monitoring does not capture local workspace data.
- [ ] Privacy review is required before adding any new telemetry field.

## Allowed event data

Allowed when needed for ad serving, rewards, fraud prevention, and reporting:

- [ ] user_id.
- [ ] device_id.
- [ ] session_id.
- [ ] extension_version or cli_version.
- [ ] tool_type.
- [ ] coarse country/region.
- [ ] wait_state_start and wait_state_end.
- [ ] ad_request.
- [ ] ad_rendered.
- [ ] qualified_impression.
- [ ] click.
- [ ] campaign_id and creative_id.
- [ ] timestamp.
- [ ] rate-limit and fraud signals that do not include private content.

## User rights and account controls

- [ ] Privacy policy exists.
- [ ] Terms of service exists.
- [ ] Payout policy exists.
- [ ] Advertiser policy exists.
- [ ] Prohibited content policy exists.
- [ ] User can request data export.
- [ ] User can request account deletion.
- [ ] Deleted account stops ad serving.
- [ ] Retention exceptions are documented for ledger, fraud, payout, tax, and legal records.
- [ ] Support can explain estimated, pending, confirmed, held, available, reversed, and paid balances.

## Advertiser compliance

MVP prohibited categories:

- [ ] Gambling.
- [ ] Adult content.
- [ ] Illegal products.
- [ ] Fake investment schemes.
- [ ] Malware.
- [ ] Phishing.
- [ ] Get-rich-quick scams.
- [ ] Shady crypto.
- [ ] Political ads.
- [ ] Deceptive financial products.
- [ ] Fake AI tools.
- [ ] Any campaign that damages developer trust.

Campaign moderation checklist:

- [ ] Landing page checked.
- [ ] Destination URL checked.
- [ ] Message text checked.
- [ ] Category checked.
- [ ] Advertiser identity checked.
- [ ] Prohibited claims checked.
- [ ] Misleading copy checked.
- [ ] Security and malware risk checked.
- [ ] Manual approval recorded.

## Payout and earnings compliance

- [ ] Marketing avoids fixed income promises.
- [ ] Dashboard says estimated earnings are not final.
- [ ] Dashboard separates estimated, pending, confirmed, held, available, and paid.
- [ ] Payout availability is provider and country dependent.
- [ ] Manual payout transaction IDs are recorded.
- [ ] Payout records are retained according to legal and tax requirements.
- [ ] Tax responsibility language exists.
- [ ] Large or suspicious payouts require additional review.
- [ ] Sanctions and restricted-region process is defined before scale.

## Security checklist

- [ ] HTTPS only.
- [ ] Secure session cookies or bearer token strategy.
- [ ] Device-scoped credentials.
- [ ] Signed extension events.
- [ ] Webhook signature verification.
- [ ] Rate limiting on auth, events, clicks, and payouts.
- [ ] RBAC for developer, advertiser, support, admin, super admin.
- [ ] Audit logs for admin and sensitive actions.
- [ ] Secrets in environment variables or managed secret store.
- [ ] No secrets in repository.
- [ ] Error monitoring configured.
- [ ] Structured logging with request IDs.
- [ ] Dependency scanning before release.

## BigInt monetary migration checklist

- [x] Prisma schema uses `BigInt` for all monetary columns (campaigns, ledgers, payouts, referrals, recovery debt).
- [x] API DTOs validate monetary fields as `bigint` (custom `@IsBigInt()` / `@MinBigInt()` validators).
- [x] Shared Zod response contracts coerce monetary fields to `bigint` to match wire serialization.
- [x] BigInt serialization polyfill is loaded in both production (`main.ts`) and test (`test-setup.ts`) runtimes.
- [x] Integration contract tests pass against the BigInt schema.
- [x] Prisma migration history is consistent with the schema (no INTEGER/BigInt drift for new deployments).

## Policy pages required before private beta

- [ ] Privacy Policy.
- [ ] Terms of Service.
- [ ] Payout Policy.
- [ ] Advertiser Policy.
- [ ] Prohibited Content Policy.
- [ ] Security page.
- [ ] Data Export and Deletion help page.
- [ ] FAQ covering privacy, payouts, holds, ads, and workplace use.

## Private beta compliance gate

Private beta cannot start until:

- [ ] Extension telemetry schema is reviewed.
- [ ] Policy pages are published.
- [ ] Campaign moderation is manual.
- [ ] Payouts are manual and ledger-backed.
- [ ] Fraud holds are active.
- [ ] Users can disable ads.
- [ ] Ads are labeled in every surface.
