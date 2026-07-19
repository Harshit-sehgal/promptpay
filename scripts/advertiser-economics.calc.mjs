// Standalone, dependency-free model for WaitLayer advertiser/developer economics.
//
// This is an ANALYSIS artifact for docs/ADVERTISER_ECONOMICS.md. It does NOT
// change any billing, ledger, or payout logic in the application. All figures
// are explicit assumptions that any reviewer can adjust at the top of the file.
//
// Run:  node scripts/advertiser-economics.calc.mjs   (or `pnpm econ`)
//
// Model unit: outcomes per 1,000 ELIGIBLE wait states (a "wait" = a detected
// AI coding-assistant wait state where an ad could, in principle, be served).

import { writeFileSync } from 'node:fs';

const usd = (n) => `$${n.toFixed(2)}`;

// Accumulate the human-readable report so it can also be written to the doc.
const ECON_OUT = [];
const elog = (s) => {
  console.log(s);
  ECON_OUT.push(s);
};

// ---------------------------------------------------------------------------
// Assumptions (clearly stated; change these to re-run the scenario)
// ---------------------------------------------------------------------------
const A = {
  // Demand / delivery funnel
  fillRate: 0.70,               // share of eligible waits that actually receive an ad
  qualifiedImpressionRate: 0.85, // of served impressions that pass validity checks
  clickRate: 0.015,             // clicks per qualified impression (1.5% CTR)

  // Advertiser price (what the advertiser is billed)
  costPerQualifiedImpression: 0.012, // USD per qualified impression
  costPerClick: 0.25,                  // USD per click

  // Revenue split (standard MVP split, see docs/07-payout-strategy.md)
  developerShare: 0.60,
  platformShare: 0.30,
  reserveShare: 0.10,

  // Platform cost drivers (fractions of a stated base, unless noted)
  paymentProcessingRate: 0.029, // Stripe-style fee on advertiser gross billing
  payoutFeeRate: 0.02,          // PayPal payout fee on developer payout
  currencyConversionRate: 0.015, // on cross-border (non-USD) developer payouts
  supportCostPer1000Waits: 0.05, // amortized support tickets

  // Fraud / invalid-traffic loss (share of advertiser gross that is later
  // credited back to advertisers and/or reversed from developer earnings)
  fraudLossRate: 0.05,
};

// A worse-but-realistic stress scenario used to assert solvency.
const STRESS = {
  ...A,
  fraudLossRate: 0.08,
  paymentProcessingRate: 0.035,
  payoutFeeRate: 0.03,
  currencyConversionRate: 0.03,
  supportCostPer1000Waits: 0.15,
};

function model(a) {
  const eligibleWaits = 1000;
  const served = eligibleWaits * a.fillRate;
  const qualified = served * a.qualifiedImpressionRate;
  const clicks = qualified * a.clickRate;

  const gross =
    qualified * a.costPerQualifiedImpression + clicks * a.costPerClick;

  const developerShare = gross * a.developerShare;
  const platformShare = gross * a.platformShare;
  const reserve = gross * a.reserveShare;

  const paymentProcessing = gross * a.paymentProcessingRate;
  const payoutCost = developerShare * a.payoutFeeRate;
  const currencyConversion = developerShare * a.currencyConversionRate;
  const support = a.supportCostPer1000Waits;
  const fraudLoss = gross * a.fraudLossRate;

  const totalCosts =
    paymentProcessing + payoutCost + currencyConversion + support + fraudLoss;

  // The platform funds its operating costs from its own share PLUS the reserve
  // (the reserve exists precisely to absorb fraud and payment volatility).
  const fundsForCosts = platformShare + reserve;
  const net = fundsForCosts - totalCosts;

  return {
    eligibleWaits,
    served,
    qualified,
    clicks,
    gross,
    developerShare,
    platformShare,
    reserve,
    costPerQualifiedImpression: gross / qualified, // blended, incl. clicks
    paymentProcessing,
    payoutCost,
    currencyConversion,
    support,
    fraudLoss,
    totalCosts,
    fundsForCosts,
    net,
  };
}

function report(title, m) {
  elog(`\n=== ${title} (per 1,000 eligible waits) ===`);
  elog(`Fill rate                         : ${(A.fillRate * 100).toFixed(0)}%  -> served impressions        : ${m.served.toFixed(1)}`);
  elog(`Qualified-impression rate         : ${(A.qualifiedImpressionRate * 100).toFixed(0)}%  -> qualified impressions      : ${m.qualified.toFixed(1)}`);
  elog(`Click rate (CTR)                  : ${(A.clickRate * 100).toFixed(2)}%  -> clicks                   : ${m.clicks.toFixed(2)}`);
  elog(`Cost / qualified wait impression  : ${usd(m.costPerQualifiedImpression)} (blended, incl. clicks)`);
  elog(`Advertiser gross billing          : ${usd(m.gross)}`);
  elog(`  Developer share (60%)           : ${usd(m.developerShare)}`);
  elog(`  Platform share (30%)            : ${usd(m.platformShare)}`);
  elog(`  Reserve (10%)                   : ${usd(m.reserve)}`);
  elog(`Costs:`);
  elog(`  Payment processing              : ${usd(m.paymentProcessing)}`);
  elog(`  Payout fee (PayPal)             : ${usd(m.payoutCost)}`);
  elog(`  Currency conversion             : ${usd(m.currencyConversion)}`);
  elog(`  Support                         : ${usd(m.support)}`);
  elog(`  Fraud / invalid-traffic loss    : ${usd(m.fraudLoss)}`);
  elog(`  Total costs                     : ${usd(m.totalCosts)}`);
  elog(`Funds available for costs         : ${usd(m.fundsForCosts)} (platform + reserve)`);
  elog(`NET PLATFORM MARGIN               : ${usd(m.net)}  ${m.net > 0 ? '=> SOLVENT' : '=> INSOLVENT'}`);
}

const base = model(A);
const stress = model(STRESS);

report('BASE CASE', base);
report('STRESS CASE (higher fraud + fees)', stress);

elog('\nSolvency assertion:');
elog(`  base > 0   : ${base.net > 0}`);
elog(`  stress > 0 : ${stress.net > 0}`);
elog(`  ${base.net > 0 && stress.net > 0 ? 'PASS — platform remains solvent under both scenarios.' : 'FAIL — review assumptions.'}`);

const doc = `# WaitLayer Advertiser & Developer Economics

_Generated by \`scripts/advertiser-economics.calc.mjs\` (run \`pnpm econ\` to refresh)._

This model estimates unit economics per 1,000 eligible AI-coding wait states.
All figures are explicit assumptions at the top of the script and can be
adjusted. It does NOT change billing, ledger, or payout logic.

\`\`\`text
${ECON_OUT.join('\n')}
\`\`\`

## How to read it

- **Developer** receives ${Math.round(A.developerShare * 100)}% of advertiser gross billing.
- **Platform** keeps ${Math.round(A.platformShare * 100)}% plus the ${Math.round(A.reserveShare * 100)}% reserve, which funds payment
  processing, payout fees, currency conversion, support, and fraud/invalid-traffic losses.
- The **NET PLATFORM MARGIN** (platform + reserve − costs) must stay positive in
  both the base and stress scenarios for the unit economics to be solvent.
`;

writeFileSync(new URL('../docs/ADVERTISER_ECONOMICS.md', import.meta.url), doc);
elog('\nWrote docs/ADVERTISER_ECONOMICS.md');
