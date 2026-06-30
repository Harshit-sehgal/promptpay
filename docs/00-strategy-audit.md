# WaitLayer Strategy Audit

## Positioning

Working positioning: "Earn from AI wait time, globally, transparently, and safely."

WaitLayer should not position itself as "ads in your IDE." The professional framing is a compliant reward marketplace for opted-in developer attention during AI wait states. The product earns trust by being explicit about what it collects, what it never collects, how earnings move from estimated to confirmed, and how invalid traffic protects advertisers.

## Current competitor observations

As of June 30, 2026, public Kickbacks.ai pages describe a product for developer AI wait states with a visible revenue share, five-second impression rules, Stripe Connect payouts, supported Claude Code surfaces, and privacy claims around not collecting code, prompts, completions, files, or project contents.

This creates a narrow but real category. The opportunity is not simply adding PayPal. The stronger opportunity is to build a more bankable marketplace foundation:

- Multi-provider payout abstraction instead of a single payout rail.
- Ledger-first accounting rather than a simple balance.
- Clear separation of estimated, pending, confirmed, held, available, and paid earnings.
- Advertiser tooling beyond a simple bid queue.
- Invalid-traffic credits and campaign-quality controls.
- Privacy-first clients with a telemetry schema that cannot carry source code or prompt content.
- Fraud scoring and payout holds from the first private beta.
- Global rollout that is honest about regional provider, tax, and sanctions limits.

## Weak assumptions to validate

1. Developer tolerance

Developers may reject sponsored messages inside work tools even when paid. The first beta must measure uninstall rate, disable rate, ad report rate, and 30-day retention before scaling advertiser demand.

2. Advertiser ROI

Developer-tool advertisers may like the novelty but still need repeatable ROI. Early campaigns need clean reporting, invalid-traffic controls, and optional conversion tracking before larger budgets.

3. Payout access

"Global payouts" cannot mean every user in every country can immediately withdraw. PayPal, Stripe Connect, Wise, Payoneer, Razorpay, banks, tax requirements, sanctions, and local rules vary. WaitLayer should say "global-first payout roadmap" until coverage is proven.

4. Fraud economics

If rewards are too high relative to friction, abuse will arrive immediately. The MVP must make high-volume earning impossible for new or low-trust users until review windows pass.

5. Integration durability

AI coding tools and terminal UIs change quickly. The first integration should be stable and narrow: VS Code extension plus terminal CLI wrapper. Avoid shipping ten fragile integrations.

6. Legal and employer concerns

Some developers cannot run ad/reward software on company devices. The product must provide clear workplace-use language, visible privacy controls, and a clean disable/uninstall path.

## Strategic choices

- Start with VS Code extension, terminal CLI wrapper, web dashboard, and admin tools.
- Use PayPal email/manual payout recording for MVP, then automate PayPal Payouts if eligibility is approved.
- Use Stripe for advertiser payments first because advertiser card checkout is lower risk than global user payouts.
- Add Stripe Connect later where it improves coverage or tax onboarding.
- Keep the client telemetry schema intentionally small.
- Make the extension source auditable before public launch.
- Treat fraud review, payout holds, and advertiser credits as product features, not back-office afterthoughts.

## MVP marketplace loop

1. Developer signs up and opts in.
2. Developer installs VS Code extension or CLI wrapper.
3. Client registers device and starts a wait-state session.
4. API validates user, device, rate limits, preferences, and targeting.
5. Ad server returns one labeled sponsored message.
6. Client renders the ad and sends a rendered event.
7. After minimum visible duration, client sends a qualified impression event.
8. Ledger records advertiser spend, user estimated earnings, platform fee, and reserve.
9. Fraud jobs score event, user, device, and campaign.
10. Earnings mature after review window from estimated to confirmed.
11. User requests PayPal payout above threshold.
12. Admin approves, manually pays, records transaction, and ledger moves funds to paid.

## Non-goals for MVP

- No broad SDK marketplace at launch.
- No browser extension at launch.
- No automatic payout automation before manual payout controls are proven.
- No prompt, code, filename, command, clipboard, repository, or completion collection.
- No political, adult, gambling, crypto-hype, or financial-opportunity advertising.
- No promises of fixed income or guaranteed payout timing.

## Success criteria for private beta

- 50 to 100 opted-in developers complete install.
- At least 2 advertisers run approved test campaigns.
- 10,000 valid impressions recorded.
- First 20 payout requests processed manually without ledger mismatch.
- Obvious fraud simulations are flagged before payout.
- Less than 5% traffic is suspicious after manual review.
- No credible privacy complaint involving code, prompts, completions, or filenames.

