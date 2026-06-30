# Engineering Task Breakdown

## Workstream 1: Repository and platform foundation

- Set up monorepo.
- Configure TypeScript project references.
- Add shared linting and formatting.
- Add environment variable schema.
- Add local Docker Compose for Postgres and Redis.
- Add CI for typecheck, lint, tests, migrations.
- Add structured logging package.
- Add request ID middleware.
- Add error monitoring hooks.

Acceptance:

- Fresh checkout can run local web, API, worker, database, and Redis.
- CI fails on type, lint, test, or migration errors.

## Workstream 2: Database and ORM

- Create Prisma schema.
- Create migrations for identity, campaigns, events, ledgers, payouts, fraud, audit.
- Add seed data for categories and tool integrations.
- Add database transaction helper.
- Add ledger repository with idempotency support.
- Add reporting indexes.

Acceptance:

- Migrations run cleanly.
- Seed creates MVP categories and blocked categories.
- Ledger tests pass.

## Workstream 3: Auth and roles

- Implement signup.
- Implement login/logout.
- Implement email verification.
- Implement sessions.
- Implement RBAC guards.
- Add developer, advertiser, support, admin, super admin roles.
- Add protected route helpers.

Acceptance:

- Users can sign up and log in.
- Role-restricted endpoints reject unauthorized access.
- Session revocation works.

## Workstream 4: Developer dashboard

- Build dashboard shell.
- Add overview metrics.
- Add earnings ledger view.
- Add payout page.
- Add trust status page.
- Add settings page.
- Add export/delete request UI.

Acceptance:

- Developer can understand estimated, pending, confirmed, held, available, and paid balances.
- User can disable ads and update preferences.

## Workstream 5: Extension and CLI event ingestion

- Build shared event schemas.
- Build device registration endpoint.
- Build device token and signing flow.
- Build wait-state start/end endpoints.
- Build ad request endpoint.
- Build ad rendered endpoint.
- Build qualified impression endpoint.
- Build click endpoint.
- Build report-ad endpoint.
- Add strict unknown-field rejection.

Acceptance:

- Signed events are accepted.
- Invalid signatures are rejected.
- Duplicate idempotency keys do not double-record.
- Prohibited fields are rejected.

## Workstream 6: VS Code extension

- Implement sign-in flow.
- Implement opt-in onboarding.
- Implement settings panel.
- Implement wait-state detection for a narrow supported path.
- Render sponsored message.
- Track rendered event.
- Track qualified impression after minimum visible duration.
- Track click.
- Add report-ad action.
- Add tests for event payload builder.

Acceptance:

- Extension can show a labeled sponsored message.
- Extension does not collect code, prompts, completions, filenames, clipboard, or terminal commands.
- User can disable ads.

## Workstream 7: Terminal CLI wrapper

- Implement login.
- Register CLI device.
- Wrap supported wait-state command flow.
- Render one-line sponsored message.
- Send signed events.
- Add config command for opt-in, categories, and quiet mode.

Acceptance:

- CLI can request and render a labeled sponsored message.
- CLI does not collect command contents unless a future explicit consent mode is designed.

## Workstream 8: Advertiser dashboard and billing

- Build advertiser profile.
- Build campaign list.
- Build campaign creation form.
- Build targeting form.
- Build campaign submit/pause/resume.
- Integrate Stripe deposit flow.
- Add advertiser reports.

Acceptance:

- Advertiser can fund account.
- Advertiser can create campaign.
- Advertiser can submit campaign.
- Advertiser can view spend, impressions, clicks, CTR, invalid traffic, and remaining budget.

## Workstream 9: Campaign moderation and ad serving

- Build admin campaign approval queue.
- Build creative review checklist.
- Implement campaign status transitions.
- Implement targeting matcher.
- Implement frequency caps.
- Implement budget reservation.
- Implement ad selection scoring.
- Implement no-ad fallback.

Acceptance:

- Only approved funded campaigns serve.
- Budget cannot go negative.
- Frequency caps are enforced.
- Bad campaigns can be paused by admin.

## Workstream 10: Ledger and earnings

- Implement revenue split config.
- Implement billable impression transaction.
- Implement advertiser debit entries.
- Implement user estimated entries.
- Implement platform fee and reserve entries.
- Implement ledger maturation job.
- Implement reversal and advertiser credit.
- Implement balance aggregation.

Acceptance:

- Ledger balances reconcile.
- Duplicate events do not create duplicate entries.
- Confirmed earnings exclude pending, held, reversed, and paid entries.

## Workstream 11: Payouts

- Implement payout account model.
- Implement PayPal email collection.
- Implement payout request endpoint.
- Implement payout threshold rules.
- Implement admin payout queue.
- Implement approve/reject flow.
- Implement manual mark-paid flow.
- Implement payout history.
- Implement provider interface and ManualProvider.

Acceptance:

- User can request payout above threshold.
- Admin can approve, reject, and mark paid.
- Transaction ID is required for manual paid status.
- Ledger moves entries to paid exactly once.

## Workstream 12: Fraud and trust

- Implement rate limits.
- Implement FraudFlag model and APIs.
- Implement TrustScore calculation.
- Implement payout hold logic.
- Implement suspicious impression rules.
- Implement suspicious click rules.
- Implement duplicate payout destination rule.
- Implement invalid traffic reversal.
- Build admin fraud review page.

Acceptance:

- Fraud simulations create flags.
- Restricted users cannot withdraw.
- Invalid traffic credits advertiser and reverses earnings.

## Workstream 13: Policies and public site

- Build landing page.
- Build developer page.
- Build advertiser page.
- Build payout page.
- Build privacy page.
- Build security page.
- Build policy pages.
- Build waitlist forms.
- Build comparison page with careful claims.

Acceptance:

- Policies are visible before beta.
- Public claims avoid unsupported income and universal payout promises.

## Workstream 14: Testing and release

- Unit tests for ledger, payouts, fraud, campaign budget.
- API integration tests for auth, extension events, campaigns, payouts.
- Extension event payload tests.
- E2E private beta happy path.
- Load test ad request endpoint.
- Security review of event payloads and secrets.
- Beta launch checklist.

Acceptance:

- Required test suite passes.
- Private beta can run with 100 developers and 2 advertisers.

