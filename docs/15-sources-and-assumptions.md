# Sources and Assumptions

## Public sources reviewed

Competitor/category:

- Kickbacks.ai public website: https://kickbacks.ai/

Payout/provider references:

- PayPal Payouts documentation: https://developer.paypal.com/docs/payouts/
- Stripe Connect documentation: https://docs.stripe.com/connect
- Stripe global availability: https://stripe.com/global

Advertising and disclosure references:

- FTC native advertising guide: https://www.ftc.gov/business-guidance/resources/native-advertising-guide-businesses
- FTC dot-com disclosures: https://www.ftc.gov/business-guidance/resources/dotcom-disclosures-information-about-online-advertising

Privacy references:

- ICO data minimisation guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/the-principles/data-minimisation/
- California Consumer Privacy Act official page: https://oag.ca.gov/privacy/ccpa

## Date-sensitive assumptions

These assumptions were made on June 30, 2026 and should be rechecked before implementation:

- Competitor feature set, payout methods, revenue share, and supported integrations may change.
- PayPal Payouts availability and approval requirements may vary by business account, country, and use case.
- Stripe Connect availability and cross-border payout coverage may vary by country and account type.
- Local payout providers may impose KYC, tax, sanctions, marketplace, or reward-program restrictions.
- Advertising disclosure expectations may vary by jurisdiction.
- Privacy and data rights requirements may vary by user location.

## Business assumptions

- Developers will consider opt-in sponsored messages if they are non-intrusive, clearly labeled, privacy-preserving, and paid transparently.
- Developer-tool advertisers will test small budgets for verified developer attention.
- PayPal-first support is a meaningful differentiator for users outside Stripe Connect supported regions, but it is not sufficient as a long-term moat.
- Manual campaign approval and manual payouts are acceptable for MVP because they reduce risk.
- Fraud pressure will begin as soon as rewards are real.

## Technical assumptions

- VS Code extension APIs are sufficient for a narrow initial wait-state experience.
- CLI wrapper can support explicit wait-state flows without collecting terminal command contents.
- PostgreSQL is adequate for MVP event volume if indexes and aggregation jobs are designed carefully.
- Redis/BullMQ is sufficient for MVP async jobs.
- Strict event schemas can enforce privacy promises better than policy text alone.

## Compliance assumptions

- WaitLayer must not claim universal payout availability until provider coverage is proven.
- WaitLayer should avoid fixed earning promises.
- Ad labels must be clear and visible.
- Payout records, ledger records, fraud evidence, and audit logs may need retention even after user deletion requests, subject to applicable law.
- Legal review is required before public launch.

## Open questions

- Which countries should be supported in private beta?
- What payout threshold balances user trust, fraud risk, and payment fees?
- Should GitHub verification be optional trust-score input or required for payout?
- What exact display surface in VS Code creates the least friction?
- What CPM range can advertisers support while still funding meaningful user rewards?
- How long should reserve funds be held before release?
- Which provider should be second after manual PayPal: automated PayPal Payouts, Stripe Connect, or Wise/Payoneer?

