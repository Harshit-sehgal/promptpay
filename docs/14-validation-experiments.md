# Validation Experiments

## Experiment 1: Developer waitlist landing page

Goal: validate whether developers want to earn from AI wait time.

Hypothesis:

Developers using AI coding assistants will join a waitlist for opt-in sponsored messages if privacy and payouts are explained clearly.

Method:

- Launch landing page with developer-focused messaging.
- Run targeted traffic from developer communities, newsletters, and small paid campaigns.
- Offer transparent privacy statement and sample ad.
- Ask tool usage, payout preference, and tolerance questions after signup.

Success:

- 500 signups or 20%+ conversion from targeted traffic.
- At least 40% of signups use AI coding assistants weekly.
- At least 30% say PayPal is preferred or acceptable.

Failure signal:

- Conversion below 5% from relevant traffic.
- Privacy concerns dominate responses.
- Users say ads in IDE/terminal are unacceptable even when opt-in.

Decision:

- If success, proceed to extension tolerance prototype.
- If mixed, revise display format and privacy copy.
- If failure, pivot to advertiser-funded developer perks outside IDE surfaces.

## Experiment 2: Advertiser interview campaign

Goal: validate whether developer-tool advertisers will pay for this inventory.

Hypothesis:

Developer-tool advertisers will test $50 to $100 campaigns if WaitLayer provides verified impressions, targeting, and invalid-traffic reporting.

Method:

- Interview 25 to 40 developer-tool founders or growth leads.
- Show mock advertiser dashboard and sample inventory.
- Ask for pilot commitment and target CPM.
- Collect objections about brand safety, attribution, and fraud.

Success:

- 10 advertisers agree to test with $50 to $100.
- At least 5 provide concrete campaign copy and audience criteria.
- Target CPM supports meaningful developer rewards after reserve and platform fee.

Failure signal:

- Advertisers only want CPA or free tests.
- Fraud and attribution objections cannot be resolved.
- CPM willingness is too low for user rewards.

Decision:

- If success, build advertiser MVP.
- If mixed, add conversion tracking or better targeting before scaling.
- If failure, reconsider inventory model.

## Experiment 3: Extension tolerance test

Goal: validate whether developers keep the extension installed.

Hypothesis:

Developers will tolerate short, labeled sponsored messages during wait states when ads are opt-in, easy to disable, and privacy-safe.

Method:

- Invite 50 developers.
- Use test ads or house campaigns.
- Track install, opt-in, disable, uninstall, report-ad, and feedback.
- Interview churned users.

Success:

- 30%+ 30-day retention among beta users.
- Less than 15% disable ads in first week.
- Less than 5% report privacy concerns after telemetry explanation.

Failure signal:

- Users uninstall after first ad.
- Ads feel intrusive.
- Users do not believe privacy promises.

Decision:

- If success, continue beta.
- If mixed, change frequency, placement, or category controls.
- If failure, use dashboard/email reward placements instead of IDE/terminal ads.

## Experiment 4: Earnings trust test

Goal: validate whether transparent earnings dashboard improves trust.

Hypothesis:

Users understand estimated, pending, confirmed, held, available, and paid states when explained directly in the dashboard.

Method:

- Show dashboard prototype to 15 to 25 developers.
- Ask them to explain how much they can withdraw and why.
- Test payout hold explanations.
- Test fraud reversal language.

Success:

- 80% correctly identify available payout amount.
- 80% understand why estimated earnings are not final.
- Less than 10% describe holds as hidden or suspicious after explanation.

Failure signal:

- Users perceive holds as unfair.
- Users confuse confirmed and available.
- Users think estimated earnings are guaranteed.

Decision:

- If success, implement dashboard.
- If mixed, simplify balance terminology.
- If failure, delay public payout claims and redesign earnings UX.

## Experiment 5: Fraud simulation

Goal: test fake impressions, repeated clicks, duplicate devices, and payout abuse.

Hypothesis:

The MVP fraud system flags obvious abuse before payout.

Method:

- Simulate repeated wait-state loops.
- Replay impression tokens.
- Replay clicks.
- Create multiple accounts with shared payout email.
- Trigger high CTR campaign behavior.
- Attempt payout from a new account with high earning velocity.
- Run campaign budget exhaustion concurrency test.

Success:

- Duplicate events do not double-bill.
- Obvious abuse creates fraud flags.
- New high-earning accounts are held.
- Restricted accounts cannot request payout.
- Invalid traffic can be credited to advertiser.

Failure signal:

- Fraud reaches payout request without hold.
- Budget goes negative.
- Ledger cannot reverse invalid traffic cleanly.

Decision:

- If success, allow limited manual payouts.
- If mixed, extend hold windows and tighten caps.
- If failure, do not run paid beta.

## Experiment 6: Payout trust pilot

Goal: validate manual PayPal payout workflow and user trust.

Hypothesis:

Manual PayPal payouts are acceptable for MVP if status is transparent and transaction IDs are recorded.

Method:

- Process 20 real or test payouts.
- Measure request to paid time.
- Ask users whether status was clear.
- Reconcile ledger entries before and after payout.

Success:

- 20 successful payout requests.
- 0 ledger reconciliation errors.
- 95% payout success rate for eligible users.
- Users can find transaction history without support.

Failure signal:

- Users distrust manual payout.
- Payout accounting is hard to reconcile.
- PayPal issues block common regions.

Decision:

- If success, continue manual in beta.
- If mixed, improve status and operations.
- If failure, prioritize automated provider or alternative rail before launch.

## Experiment 7: Advertiser reporting trust test

Goal: validate whether advertisers understand performance and invalid-traffic protection.

Hypothesis:

Advertisers will trust reports that show billable impressions, clicks, CTR, spend, remaining budget, and invalid traffic.

Method:

- Show report prototype to pilot advertisers.
- Walk through a campaign with invalid traffic adjustments.
- Ask what is missing for repeat purchase.

Success:

- 70% say reports are sufficient for a $100 to $500 pilot.
- Advertisers understand invalid traffic credits.
- Top requested additions are incremental, not foundational.

Failure signal:

- Advertisers require conversion attribution before any spend.
- Invalid traffic reporting is confusing.
- They do not trust the inventory source.

Decision:

- If success, build reports as designed.
- If mixed, add UTM/conversion guidance.
- If failure, redesign advertiser proposition.

