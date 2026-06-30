# Technical Architecture Document

## Architecture overview

WaitLayer is a modular marketplace system with four first-class surfaces:

- Web app: developer, advertiser, admin, support, and public pages.
- API: auth, ad serving, event ingestion, campaign management, ledger, payouts, fraud, admin, and reporting.
- VS Code extension: opt-in ad display, settings, wait-state detection, signed event reporting, and dashboard deep links.
- Terminal CLI wrapper: controlled wait-state events and sponsored line rendering for supported terminal flows.

## Recommended stack

- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: NestJS, TypeScript, PostgreSQL, Prisma, Redis, BullMQ.
- Extension: VS Code extension in TypeScript.
- CLI: Node.js TypeScript package.
- Payments: Stripe for advertiser deposits; PayPal email/manual payouts for MVP.
- Infrastructure: Railway, Render, or Fly.io for MVP; object storage for exports and reports; managed Postgres and Redis.
- Observability: structured logs, request IDs, error monitoring, uptime checks, admin health view.

## Monorepo layout

```text
apps/
  web/
  api/
  vscode-extension/
  cli/
packages/
  config/
  db/
  eslint-config/
  shared/
  ui/
docs/
```

## Backend modules

- AuthModule: signup, login, email verification, sessions, roles.
- UserModule: developer profile, settings, privacy controls, verification.
- AdvertiserModule: profiles, billing setup, campaign ownership.
- CampaignModule: campaigns, creatives, targeting, approvals, status transitions.
- AdServingModule: campaign matching, budget checks, frequency caps, response generation.
- EventModule: wait states, ad requests, rendered events, impressions, clicks, reports.
- LedgerModule: advertiser spend, user earnings, platform fee, reserve, refunds, payouts.
- PayoutModule: payout accounts, payout requests, provider abstraction, manual payout records.
- FraudModule: rules, trust score, flags, holds, invalid traffic, review queues.
- AdminModule: review surfaces, role management, policy controls.
- AuditModule: immutable admin and sensitive-user-action logs.
- ReportingModule: developer, advertiser, platform, and fraud metrics.

## Event pipeline

1. Client authenticates and registers device.
2. Client opens wait-state with a generated wait_state_id.
3. Client requests ad with user_id, device_id, session_id, tool_type, country/region, extension_version, and allowed categories.
4. API validates auth, signature, schema, feature flags, user status, device status, rate limits, and preferences.
5. AdServingModule selects campaign using targeting, budget, frequency caps, bid, relevance, and quality score.
6. API returns short sponsored message, click URL, impression token, and display requirements.
7. Client renders the label and message.
8. Client sends ad_rendered event.
9. Client sends qualified_impression only after minimum visible duration.
10. API idempotently records the impression and creates pending ledger entries.
11. Fraud queue scores event and user.
12. Ledger maturation job confirms eligible earnings after review window or holds suspicious earnings.
13. Reporting jobs aggregate daily metrics for dashboards.

## Ad selection

Inputs:

- User preferences and blocked categories.
- Tool type, country, developer category, stack/interest, platform.
- Campaign status, approval status, budget, bid, frequency caps.
- Campaign quality score and advertiser trust.
- User trust level and fraud risk.

Selection steps:

1. Filter active approved campaigns.
2. Remove campaigns that violate user preferences, country/tool/category targeting, or frequency caps.
3. Remove campaigns without budget reserve for the impression.
4. Score remaining candidates by bid, relevance, quality score, delivery pacing, and marketplace diversity.
5. Reserve budget for the chosen campaign using a short-lived reservation.
6. Return one sponsored message.

Budget safety:

- Use transactional budget reservation.
- Use idempotency keys for impression qualification.
- Release unused reservation if rendered or qualified event does not arrive within timeout.
- Never allow spend beyond campaign remaining budget.

## Ledger architecture

The ledger is append-only. Balances are derived from entries, not mutated as a single source of truth.

Ledger dimensions:

- User earnings ledger.
- Advertiser ledger.
- Platform revenue ledger.
- Fraud/payment reserve ledger.
- Payout ledger.
- Refund/credit ledger.

Core invariant:

For each billable impression, advertiser debit equals user estimated credit plus platform fee credit plus reserve credit.

Maturation:

- estimated: created immediately after qualified impression.
- pending: waiting for review window and aggregation.
- confirmed: fraud checks pass and hold expires.
- held: fraud review or payout policy hold.
- reversed: invalid traffic or policy violation.
- paid: included in completed payout.

## Fraud architecture

Fraud prevention has synchronous and asynchronous layers.

Synchronous gate:

- Auth and device status.
- Request signature.
- Basic schema validation.
- Rate limits by user, device, IP hash, session, campaign.
- Budget and duplicate checks.
- User status: restricted or banned users cannot earn.

Async scoring:

- Impressions per user/device/IP hash over rolling windows.
- Repeated wait-state loops.
- Impossible activity volume.
- CTR anomalies.
- Click timing anomalies.
- Duplicate accounts and shared payout identifiers.
- Network fan-out and proxy/VPN-heavy signals.
- Country/device drift.
- New-account earning velocity.

Outputs:

- FraudFlag records.
- TrustScore updates.
- Earnings holds or reversals.
- Account restrictions.
- Advertiser invalid-traffic credits.

## Payout provider abstraction

Interface:

```ts
interface PayoutProvider {
  createRecipient(input: CreateRecipientInput): Promise<CreateRecipientResult>;
  validateRecipient(input: ValidateRecipientInput): Promise<ValidateRecipientResult>;
  createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult>;
  checkPayoutStatus(providerPayoutId: string): Promise<PayoutStatusResult>;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
  markFailed(input: MarkFailedInput): Promise<void>;
  markCompleted(input: MarkCompletedInput): Promise<void>;
}
```

MVP providers:

- ManualProvider.
- PayPalEmailProvider, which validates email format and records destination for manual payout.

Later providers:

- PayPalPayoutsProvider.
- StripeConnectProvider.
- PayoneerProvider.
- WiseProvider.
- RazorpayProvider.

## Privacy architecture

Allowed event fields:

- user_id, device_id, session_id.
- extension_version, cli_version, tool_type, platform.
- country/region from coarse IP lookup or client locale where lawful.
- wait_state_start, wait_state_end.
- ad_request, ad_rendered, qualified_impression, click.
- campaign_id, creative_id, timestamp.
- fraud signals that do not include private content.

Prohibited default fields:

- Source code.
- File contents.
- File names.
- Private prompts.
- AI completions.
- Clipboard contents.
- Terminal command contents.
- Repository contents.
- Project names.

Enforcement:

- Shared validation schemas reject unknown fields for extension endpoints.
- Client event builder has no content fields.
- Server stores IP hash for anti-abuse where possible and avoids raw IP retention except short-lived security logs.
- Privacy tests assert prohibited fields cannot be serialized.

## Security controls

- HTTPS only.
- JWT or session cookies for web auth.
- Device-scoped API tokens for extension and CLI.
- Signed client events with rotating device secret.
- Idempotency keys for event ingestion, deposits, ledger entries, and payouts.
- Role-based access control.
- Rate limits by route, user, device, IP hash, and campaign.
- Audit logs for admin, payout, fraud, campaign approval, and role changes.
- Secrets stored in environment variables or managed secret store.
- Webhook signature verification for Stripe and future payout providers.
- Dependency scanning and extension package signing before public release.

## Deployment model

MVP:

- Web and API deployed separately or as services in one platform account.
- Managed Postgres.
- Managed Redis.
- Worker service for BullMQ.
- Background scheduler for ledger maturation, fraud aggregation, and payout reminders.

Scale path:

- Split event ingestion from core API.
- Add read replicas for reporting.
- Add partitioning for high-volume event tables.
- Move aggregation to warehouse or ClickHouse only after Postgres limits are visible.
- Add regional edge for ad request latency if needed.

## Failure modes

- If ad serving fails, client shows no ad and workflow continues.
- If rendered event fails, no qualified impression is recorded.
- If qualified impression succeeds but ledger job fails, event remains queued and idempotent replay creates entries once.
- If payout marking fails, payout remains in approved or processing state until reconciled.
- If fraud jobs lag, earnings stay pending and unavailable for payout.

