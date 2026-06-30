# UI Page List

## Public website

### Landing page

Purpose: explain the category and collect developer and advertiser interest.

Required content:

- Headline: "Earn from AI wait time."
- Subheadline: "WaitLayer helps developers earn from opt-in sponsored messages shown during AI coding assistant wait states, with PayPal-first payouts, transparent earnings, and privacy-first integrations."
- Developer benefits.
- Advertiser benefits.
- Privacy-first proof points.
- Waitlist calls to action.
- No income guarantees.

### How it works

Sections:

- Developer opt-in.
- Eligible wait states.
- Sponsored message display.
- Valid impression rules.
- Estimated vs confirmed earnings.
- Payout holds.
- Advertiser billing and invalid traffic.

### For developers

Sections:

- Earnings overview.
- Supported tools.
- Privacy promises.
- Controls and category preferences.
- Payout options.
- Workplace-use note.

### For advertisers

Sections:

- Developer attention inventory.
- Targeting.
- Reporting.
- Fraud protection.
- Campaign review.
- Early advertiser waitlist.

### Payouts

Sections:

- PayPal-first MVP.
- Minimum threshold.
- Manual review.
- Hold windows.
- Future provider roadmap.
- Country/provider limits.

### Privacy

Sections:

- What WaitLayer collects.
- What WaitLayer does not collect.
- How events are used.
- Data export and deletion.
- Security controls.

### Security

Sections:

- Signed extension events.
- Rate limits.
- Audit logs.
- Payout review.
- Responsible disclosure contact.

### Policies

Required pages:

- Terms.
- Privacy Policy.
- Advertiser Policy.
- Payout Policy.
- Prohibited Content Policy.

### FAQ

Topics:

- Does WaitLayer read my code?
- Does WaitLayer read my prompts?
- Can I disable ads?
- How do earnings work?
- Why are earnings held?
- How do PayPal payouts work?
- What countries are supported?
- Can I use this on a work device?

### Comparison page

Purpose: compare WaitLayer against alternatives without unsupported claims.

Rules:

- Do not claim "100x better overall."
- Compare measurable areas: payout flexibility, transparency, privacy, fraud controls, advertiser tooling, and integration roadmap.
- Avoid unverified claims about competitor internals.

### Waitlist page

Forms:

- Developer waitlist.
- Advertiser pilot interest.

### Contact page

Forms:

- General contact.
- Advertiser inquiry.
- Security/privacy inquiry.

## Developer dashboard

### Overview

Cards:

- Today estimated.
- Pending earnings.
- Confirmed earnings.
- Held earnings.
- Available for payout.
- Lifetime earnings.
- Trust level.
- Payout hold status.

Charts:

- Earnings over time.
- Valid impressions.
- Clicks.

### Activity

Tables:

- Recent sponsored messages.
- Qualified impressions.
- Clicks.
- Reported ads.

Filters:

- Date range.
- Tool.
- Campaign category.

### Payouts

Sections:

- Payout method.
- Available balance.
- Minimum threshold.
- Request payout.
- Payout history.
- Failed payouts.
- Hold explanations.

### Trust and Fraud Status

Sections:

- Account status.
- Trust level.
- Verification status.
- Hold status.
- Suggested trust improvements.

Do not expose exact fraud thresholds.

### Settings

Sections:

- Ads enabled.
- Quiet mode.
- Max ads per hour.
- Allowed categories.
- Blocked categories.
- Connected accounts.
- Privacy export.
- Delete account.

## Extension UI

### Onboarding

Steps:

- Sign in.
- Confirm opt-in.
- Explain privacy promises.
- Set categories.
- Show sample sponsored message.

### Sponsored message view

Requirements:

- Label first: "Sponsored" or "Ad."
- Short advertiser and message.
- Click target is explicit.
- Report action.
- Open dashboard action.
- Never blocks workflow.

Example:

```text
Sponsored - Supabase: Build faster with Postgres
```

### Settings panel

Controls:

- Enable ads.
- Quiet mode.
- Max ads per hour.
- Categories.
- Report issue.
- Open dashboard.
- Sign out.

## Terminal CLI

### Setup command

- Login.
- Device registration.
- Opt-in confirmation.
- Category setup.

### Wait-state display

Requirements:

- One-line sponsored message.
- Label first.
- No command interception beyond explicit wrapper behavior.
- No terminal command content collection.

## Advertiser dashboard

### Overview

Cards:

- Spend.
- Impressions.
- Clicks.
- CTR.
- Active campaigns.
- Budget remaining.
- Invalid traffic.

### Campaigns

Actions:

- Create.
- Edit.
- Submit.
- Pause.
- Resume.
- Duplicate.
- Archive.

### Campaign builder

Fields:

- Campaign name.
- Sponsored message.
- Destination URL.
- Display domain.
- Category.
- Budget.
- Bid type.
- CPM bid.
- Target countries.
- Target tools.
- Developer category.
- Stack/interest.
- Frequency caps.

### Reports

Views:

- Daily performance.
- Campaign performance.
- Country breakdown.
- Tool breakdown.
- Invalid traffic.
- Spend breakdown.

### Billing

Sections:

- Add funds.
- Payment history.
- Invoices.
- Current balance.

## Admin dashboard

Pages:

- Platform overview.
- User management.
- Advertiser management.
- Campaign approvals.
- Fraud review.
- Payout requests.
- Ledger and revenue.
- Reports.
- System health.
- Audit log.
- Policy controls.

## Support/reviewer dashboard

Pages:

- User lookup.
- Payout status.
- Campaign status.
- Fraud flag notes.
- Support notes.

Access is limited and audited.

