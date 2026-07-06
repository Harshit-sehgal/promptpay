# Definition of Done

## MVP definition of done

The MVP is done only when every item below is true and verified in the current product state.

Developer flow:

- [ ] Developer can sign up.
- [ ] Developer can log in.
- [ ] Developer can install VS Code extension.
- [ ] Developer can opt in to ads.
- [ ] Developer can disable ads.
- [ ] Extension shows clearly labeled sponsored messages.
- [ ] Ads are non-intrusive and never block workflow.
- [ ] Valid impressions are tracked.
- [ ] Clicks are tracked.
- [ ] User can report an ad.
- [ ] User can control categories.
- [ ] User can view estimated earnings.
- [ ] User can view pending earnings.
- [ ] User can view confirmed earnings.
- [ ] User can view held earnings.
- [ ] User can view available payout balance.

Advertiser flow:

- [ ] Advertiser can create profile.
- [ ] Advertiser can create campaign.
- [ ] Advertiser can set budget.
- [ ] Advertiser can set CPM bid.
- [ ] Advertiser can select targeting.
- [ ] Advertiser can submit campaign.
- [ ] Admin can approve campaign.
- [ ] Approved funded campaign can serve.
- [ ] Advertiser spend is recorded.
- [ ] Advertiser can view impressions.
- [ ] Advertiser can view clicks.
- [ ] Advertiser can view CTR.
- [ ] Advertiser can view spend.
- [ ] Advertiser can view remaining budget.
- [ ] Advertiser can view invalid traffic.
- [ ] Advertiser can pause/resume campaigns.

Ledger and payouts:

- [ ] User earnings are ledger-based.
- [ ] Advertiser spend is ledger-based.
- [ ] Platform fee is ledger-based.
- [ ] Fraud/payment reserve is ledger-based.
- [ ] Ledger entries balance for billable impressions.
- [ ] Estimated and confirmed earnings are separate.
- [ ] Fraud review window exists.
- [ ] Confirmed earnings are calculated.
- [ ] User can add PayPal payout method.
- [ ] User can request payout above threshold.
- [ ] Admin can approve payout.
- [ ] Admin can reject payout.
- [ ] Admin can mark payout paid.
- [ ] User can view payout history.

Fraud and admin:

- [ ] Events are rate-limited.
- [ ] Impressions require minimum display duration.
- [ ] Suspicious users are flagged.
- [ ] Suspicious clicks are flagged.
- [ ] Payout holds exist.
- [ ] New users have longer holds.
- [ ] Admin fraud review exists.
- [ ] Invalid traffic can be excluded.
- [ ] Admin can pause bad campaigns.
- [ ] Admin actions are audited.

Privacy and compliance:

- [ ] Privacy policy exists.
- [ ] Terms exist.
- [ ] Payout policy exists.
- [ ] Advertiser policy exists.
- [ ] Prohibited content policy exists.
- [ ] No code data is collected.
- [ ] No prompt data is collected.
- [ ] No completion data is collected.
- [ ] No file names are collected.
- [ ] No clipboard content is collected.
- [ ] No terminal command contents are collected by default.
- [ ] Users can request data export.
- [ ] Users can request deletion.
- [ ] Ads are always labeled.

Operational readiness:

- [ ] System can run a private beta with 100 users and 2 advertisers.
- [ ] Admin can reconcile payout ledger.
- [ ] Admin can review fraud flags.
- [ ] Error monitoring is enabled.
- [ ] Structured logging is enabled.
- [ ] Secrets are not hardcoded.
- [ ] Production dependency audit has no known high-risk findings.
- [ ] Automated payout providers either have real credentials/integrations or fail closed before processing.
- [ ] Core tests pass.

## V1 definition of done

V1 is done only when:

- [ ] 1,000 active developers can use the product.
- [ ] At least 10 advertisers can run campaigns.
- [ ] Payout success rate is above 95%.
- [ ] Fraud rate is below acceptable threshold.
- [ ] Advertiser reporting is reliable.
- [ ] User dashboard is trustworthy.
- [ ] Referral system works.
- [ ] Terminal CLI works.
- [ ] VS Code extension is stable.
- [ ] Admin dashboard handles moderation and payouts.
- [ ] Public launch pages are complete.
- [ ] Product has a clear comparison against competitors.
- [ ] Product has a strong trust and privacy narrative.

## Engineering definition of done for each feature

- [ ] Requirement is documented.
- [ ] Data model changes have migrations.
- [ ] API has validation schema.
- [ ] Authorization rules are tested.
- [ ] Error states are handled.
- [ ] Audit logging is added where sensitive.
- [ ] Rate limits are added where abuse-prone, and production paths use shared/distributed counters.
- [ ] User-facing copy avoids unsupported claims.
- [ ] Unit tests cover core logic.
- [ ] Integration tests cover critical path.
- [ ] Privacy review is complete for new telemetry.
- [ ] Feature is observable in logs/metrics.
- [ ] Dependency, configuration, and provider-readiness risks are reviewed for production paths.

## Evidence required before claiming done

- Passing test output.
- Migration output from clean database.
- API endpoint verification.
- UI screenshots or manual QA notes.
- Extension event payload inspection.
- Ledger reconciliation output.
- Fraud simulation results.
- Payout runbook dry run.
- Admin audit log verification.
- `pnpm audit --prod` output.
- Production rate-limit store health/config verification.
- Production payout-provider readiness check output or runbook evidence.
