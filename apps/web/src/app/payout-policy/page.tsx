import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

import { CURRENCY_POLICY, formatMinorUnits, payoutMinimumMinor } from '@ateva/shared';

export const metadata: Metadata = {
  title: 'Payout Policy — Ateva',
  description:
    'Ateva planned participant compensation policy for the future independently attested rewards launch.',
};

export default function PayoutPolicyPage() {
  const minPayout = formatMinorUnits(payoutMinimumMinor('USD'), 'USD');
  const supportedCurrencies = Object.keys(CURRENCY_POLICY);

  return (
    <div className="min-h-screen bg-surface-50">
      <SiteHeader />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-4xl px-5 py-16 sm:px-6 lg:py-20"
      >
        <h1 className="mb-8 font-serif text-4xl font-normal tracking-[-0.02em] text-surface-950 sm:text-5xl">
          Payout Policy
        </h1>

        <div className="mb-10 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-semibold">Planned launch policy — not active in beta</p>
          <p className="mt-1 text-sm leading-relaxed">
            Participant rewards and payouts are disabled during the private beta. No participant
            balance represents customer funds held by Dodo Payments or by an advertiser.
          </p>
        </div>

        <div className="prose prose-surface max-w-none">
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">
              1. Independent compensation
            </h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              If rewards launch, Ateva will define a participant compensation schedule for verified
              eligible activity. The reward rate is independent from the price an advertiser pays
              for a campaign and is accounted for as a Ateva operating cost, not as a claim on a
              specific advertiser payment.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">
              2. Fiat-only payout rail
            </h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              The initial rewards launch, if approved, will use fiat payouts only through a
              separately approved payout provider. Dodo Payments is the advertiser money-in rail and
              is not used to distribute participant rewards or split customer transactions.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">
              3. Release and fraud review
            </h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Eligible rewards can move through estimated, confirmed, held, and paid states. The
              current planned hold periods are 30 days for new accounts, 14 days for normal trust,
              and 7 days for high trust. Fraud flags or reconciliation exceptions can extend a hold
              or reverse an ineligible reward before payout.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">4. Minimum payout</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              The planned minimum payout threshold is {minPayout} (or the configured currency
              equivalent) in confirmed eligible rewards. The current currency policy includes{' '}
              {supportedCurrencies.join(', ')}; launch availability can be narrower based on the
              approved payout provider and country policy.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">5. Separation of funds</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Advertiser payment flow and participant payout flow are separate transactions:
              advertiser payment → Ateva, then independently Ateva → separate payout provider →
              eligible participant. Ateva does not instruct Dodo Payments to forward a portion of an
              advertiser transaction to a participant.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-surface-200">
          <Link
            href="/"
            className="text-brand-500 hover:text-brand-600 font-medium transition-colors"
          >
            Return to homepage
          </Link>
        </div>
      </main>
    </div>
  );
}
