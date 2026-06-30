# MVP Roadmap

## Phase 0: Research and planning

Goal: convert the idea into a constrained MVP and prove the riskiest assumptions before coding deeply.

Deliverables:

- Product requirements document.
- Technical architecture document.
- Database schema.
- API specification.
- MVP scope.
- Fraud rules.
- Payout strategy.
- Privacy and compliance checklist.
- Risk register.
- Validation plan.
- Low-fidelity wireframes.

Definition of done:

- Core marketplace loop is mapped.
- No unnecessary integrations are included.
- Stack and deployment approach are selected.
- Prohibited data list is approved.
- Ledger invariants are documented.
- Private beta success metrics are set.

## Phase 1: Foundation

Goal: set up the product shell and core platform primitives.

Deliverables:

- Monorepo.
- Next.js web app.
- NestJS API.
- PostgreSQL migrations.
- Prisma models.
- Redis and BullMQ.
- Auth, sessions, roles.
- Developer, advertiser, admin dashboard shells.
- Environment config and structured logging.
- Audit log base.

Definition of done:

- Users can sign up and log in.
- Roles gate routes and API endpoints.
- Database migrations run from a clean database.
- App has separate dev, staging, and production env config.
- Basic audit events are written for admin-sensitive actions.

## Phase 2: Developer MVP

Goal: prove opt-in ad display and event tracking from a real developer tool.

Deliverables:

- VS Code extension.
- Extension settings.
- Device registration.
- Signed wait-state, ad request, rendered, impression, click, report-ad events.
- Developer dashboard overview.
- Basic earnings view.
- Category preferences and disable toggle.

Definition of done:

- Developer can install extension.
- Developer can opt in and disable ads.
- Extension can request and show a test sponsored message.
- Every message is labeled "Ad" or "Sponsored."
- Qualified impression is recorded only after minimum visible duration.
- Click is recorded against a prior impression.
- Estimated earnings update from ledger entries.
- Client telemetry cannot include code, prompts, completions, filenames, clipboard, or terminal commands.

## Phase 3: Advertiser MVP

Goal: prove advertiser campaign creation, approval, serving eligibility, and reports.

Deliverables:

- Advertiser profile.
- Campaign creation UI.
- Creative creation UI.
- Targeting controls.
- Frequency caps.
- Campaign submission.
- Admin approval workflow.
- Advertiser reports.
- Stripe deposit flow.

Definition of done:

- Advertiser can create and submit campaign.
- Admin can approve or reject campaign.
- Approved funded campaign can serve.
- Campaign budget is decremented through ledger entries.
- Advertiser sees impressions, clicks, CTR, spend, invalid traffic, and remaining budget.
- Advertiser can pause and resume campaigns.

## Phase 4: Ledger and payout MVP

Goal: make money movement auditable before public launch.

Deliverables:

- User earnings ledger.
- Advertiser spend ledger.
- Platform and reserve ledger.
- Payout account page.
- PayPal email collection.
- Payout request flow.
- Admin payout queue.
- Manual payout marking.
- Payout history.

Definition of done:

- Ledger entries balance for every billable impression.
- Estimated, pending, confirmed, held, available, reversed, and paid states are distinct.
- User can request payout above threshold.
- Admin can approve, reject, and mark paid.
- Manual PayPal transaction ID is recorded.
- Paid payout updates ledger exactly once.
- Payout history is visible to user and admin.

## Phase 5: Fraud MVP

Goal: block obvious abuse before money leaves the system.

Deliverables:

- FraudFlag model.
- TrustScore model.
- Basic rules engine.
- Rate limits by user, device, IP hash, session, campaign.
- Payout hold logic.
- Suspicious account review.
- Invalid traffic reporting.
- Advertiser credit/reversal workflow.

Definition of done:

- Suspicious impressions are flagged.
- Suspicious clicks are flagged.
- New users have longer payout holds.
- Restricted users cannot earn or withdraw.
- Admin can resolve fraud flags.
- Invalid traffic can be excluded from billing and credited to advertiser.
- Fraud simulations are detected before payout.

## Phase 6: Private beta

Goal: run a controlled marketplace with real developers and small advertiser budgets.

Scope:

- 50 to 100 developers.
- 2 to 5 advertisers.
- Manual campaign approvals.
- Manual payouts.
- Tight payout holds.

Success metrics:

- 100 active developers.
- 10,000 valid impressions.
- 2 paying advertisers.
- 20 successful payout requests.
- Less than 5% suspicious traffic after review.
- No major privacy or security complaints.

Exit criteria:

- Ledger reconciliation passes for all beta payouts.
- Advertiser reports match ledger totals.
- Fraud review queue is manageable.
- Extension disable and uninstall flows work.
- Support issues are categorized and addressed.

## Phase 7: Public launch V1

Goal: launch the trusted public version after beta evidence supports demand and safety.

Deliverables:

- Public website.
- Developer signup.
- Advertiser waitlist or controlled self-serve.
- Referral system.
- Terminal CLI support.
- Improved reports.
- Comparison page.
- Policy pages.

Success metrics:

- 1,000 active developers.
- 10 active advertisers.
- $5,000 monthly advertiser spend.
- 95% payout success rate.
- 30-day retention above 30%.
- Fraud below acceptable threshold.

## Phase 8: Expansion

Goal: scale integrations, payout coverage, and advertiser tooling.

Potential work:

- Cursor support.
- Cline support.
- Browser extension.
- PayPal Payouts API automation.
- Stripe Connect.
- Payoneer, Wise, Razorpay, local bank payout rails.
- SDK for AI apps.
- API/MCP monetization layer.
- Conversion tracking and advertiser quality score.

Expansion gate:

- Do not add a new integration until the current VS Code and CLI surfaces are stable, measurable, and not creating support or fraud debt.

