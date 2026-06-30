# Product Requirements Document

## Product

Name: WaitLayer

One-line description: WaitLayer lets developers earn from clearly labeled, opt-in sponsored messages shown during eligible AI wait states while giving advertisers verified developer attention and invalid-traffic protection.

## Goals

- Prove the full marketplace loop from developer install to payout.
- Build a trusted payout system that starts with PayPal and can add more providers.
- Give advertisers enough reporting and fraud protection to justify repeat spend.
- Preserve privacy by design: no code, prompts, completions, filenames, clipboard content, repository data, or private terminal commands by default.
- Build a modular system that can later support more tools, payout rails, and SDK/API integrations.

## Personas

Developer/user:

- Wants optional earnings without workflow disruption.
- Needs proof that WaitLayer does not inspect private work.
- Needs transparent balances and payout status.
- Needs controls for categories, quiet mode, disable, export, and deletion.

Advertiser:

- Wants to reach developers who are actively building.
- Needs campaign controls, budget protection, basic targeting, reporting, and invalid-traffic credits.
- Needs confidence that campaigns are reviewed and the marketplace is not low-quality inventory.

Admin/reviewer:

- Needs to approve campaigns, review users, investigate fraud, approve payouts, record manual transactions, and audit every sensitive action.

Support:

- Needs read-only or limited-action views for user questions, payout status, account status, and campaign status.

Super admin:

- Needs full system controls, role management, policy controls, and emergency shutdown ability.

## MVP scope

In scope:

- Next.js web dashboard.
- Node/NestJS TypeScript API.
- PostgreSQL with migrations and ledger tables.
- Redis and BullMQ for async jobs.
- VS Code extension in TypeScript.
- Node-based terminal CLI wrapper.
- PayPal email collection and manual payout workflow.
- Stripe advertiser deposits.
- Campaign creation, submission, review, approval, pause, resume, and reporting.
- Fraud scoring, rate limits, payout holds, and manual fraud review.
- Privacy, terms, advertiser policy, payout policy, prohibited content policy, delete/export request flows.

Out of scope for MVP:

- Automated PayPal Payouts API.
- Stripe Connect payouts.
- Payoneer, Wise, Razorpay, and local bank rails.
- Cursor, Windsurf, Cline, browser extension, SDK, MCP monetization layer.
- Self-serve campaign auto-approval.
- Conversion optimization beyond optional advertiser UTM links.
- Real-time bidding exchange.

## User stories

Developer:

- As a developer, I can create an account and verify email.
- As a developer, I can connect a PayPal payout email.
- As a developer, I can install the VS Code extension.
- As a developer, I can opt in and later disable ads.
- As a developer, I can see a clearly labeled sponsored message during eligible wait states.
- As a developer, I can set category preferences and block categories.
- As a developer, I can report a bad ad.
- As a developer, I can see estimated, pending, confirmed, held, available, and paid earnings separately.
- As a developer, I can request payout after the minimum threshold.
- As a developer, I can see payout history and hold reasons.
- As a developer, I can request data export or deletion.

Advertiser:

- As an advertiser, I can create a profile.
- As an advertiser, I can create a campaign with title, message, destination URL, category, budget, bid, and targeting.
- As an advertiser, I can submit a campaign for approval.
- As an advertiser, I can pause and resume campaigns.
- As an advertiser, I can see impressions, clicks, CTR, spend, remaining budget, invalid traffic, and daily performance.
- As an advertiser, I can add funds through Stripe.

Admin:

- As an admin, I can approve or reject advertisers.
- As an admin, I can approve, reject, pause, or archive campaigns.
- As an admin, I can view impression logs, click logs, fraud flags, user trust score, and campaign delivery.
- As an admin, I can approve, reject, or mark payout requests paid.
- As an admin, I can view advertiser spend, user earnings, platform revenue, reserve, and ledger entries.
- As an admin, every sensitive action creates an audit log.

## Functional requirements

- Ads must be opt-in.
- Ads must always be labeled "Ad" or "Sponsored."
- Ads must be non-intrusive and never block workflow.
- Client must send signed events.
- Qualified impressions require a registered device, authenticated session, rendered event, minimum visibility duration, budget availability, rate limit pass, and basic fraud pass.
- Clicks require a prior valid impression from the same user/session/device and reasonable timing.
- Campaigns must be manually approved before serving in MVP.
- User earnings must be ledger-based.
- Estimated and confirmed earnings must be separate.
- New users must have longer payout holds.
- Suspicious users cannot request payout until review.
- Advertisers must receive invalid-traffic reporting and credits when traffic is invalidated.
- Admin actions must be audited.

## Non-functional requirements

- TypeScript across web, API, extension, CLI, and shared packages.
- Typed APIs with validation schemas.
- Environment-variable configuration and no hardcoded secrets.
- Structured logging and error monitoring.
- Rate limits on auth, extension events, ad requests, clicks, and payout requests.
- Database migrations for every schema change.
- Tests for ledger logic, fraud logic, payout calculations, campaign budget logic, and event qualification.
- Privacy-preserving event schema.
- Idempotent event ingestion and payout operations.

## Product principles

- Transparent earning states beat inflated balance numbers.
- Privacy promises must be enforced by schema and client design, not only policy text.
- Fraud controls must be visible enough for advertiser confidence and opaque enough to resist gaming.
- Manual approval is acceptable for MVP when it reduces legal, trust, and abuse risk.
- Global-first means provider abstraction and phased coverage, not instant universal payouts.

## Key metrics

Supply:

- Extension install completion rate.
- Opt-in rate.
- Daily active developers.
- Qualified impressions per active developer.
- Disable/uninstall rate.
- 30-day retention.

Demand:

- Advertiser signup to first deposit conversion.
- Campaign approval rate.
- Spend per advertiser.
- Repeat advertiser rate.
- CTR and cost per qualified click.

Trust:

- Payout success rate.
- Payout request approval rate.
- Average payout review time.
- Support tickets per payout.
- Privacy complaints.

Fraud:

- Invalid traffic rate.
- Fraud flags per 1,000 impressions.
- Confirmed fraud loss.
- Advertiser credits issued.

## Launch constraints

- No unsupported payout claims in marketing.
- No public self-serve advertiser launch until moderation and prohibited category controls work.
- No client release before telemetry schema is reviewed for prohibited fields.
- No payout before ledger reconciliation and payout approval logs are tested.

