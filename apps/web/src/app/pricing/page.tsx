import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  formatMinorUnits,
  payoutMinimumMinor,
} from '@ateva/shared';

export const metadata: Metadata = {
  title: 'Pricing — Ateva',
  description:
    'Ateva private beta — wait-state verification is free and live advertiser billing and participant payouts are not yet enabled.',
};

const IconCheck = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const DEVELOPER_FEATURES = [
  'Wait-state verification beta',
  'Privacy-first telemetry controls',
  'Trust and fraud-status visibility',
  'Client connection and API tooling',
];

const ADVERTISER_FEATURES = [
  'Campaign creation and draft management',
  'Creative review workflow',
  'Country and category targeting',
  'Verified-delivery reporting surfaces',
];

export default function PricingPage() {
  const minDeposit = formatMinorUnits(depositMinimumMinor('USD'), 'USD');
  const minPayout = formatMinorUnits(payoutMinimumMinor('USD'), 'USD');
  const supportedCurrencies = Object.keys(CURRENCY_POLICY);

  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <BrandMark />
            <span className="text-surface-900 font-semibold text-sm tracking-tight">Ateva</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="text-surface-600 hover:text-surface-900 text-sm font-medium px-3 py-1.5"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup?role=developer"
              className="bg-surface-900 hover:bg-surface-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Join beta
            </Link>
          </div>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1}>
        <section className="pt-36 pb-16 px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 mb-5">
              Private beta · real-money switches disabled
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
              Beta access, not commercial pricing
            </h1>
            <p className="text-surface-500 text-lg max-w-2xl mx-auto">
              Wait-state verification is free during beta. Advertisers can evaluate campaign
              tooling, but live billing and participant payouts stay disabled until their production
              reviews are complete.
            </p>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border-2 border-surface-200/80 rounded-2xl p-8">
              <p className="text-xs uppercase tracking-wider text-brand-700 font-semibold mb-4">
                Developers
              </p>
              <p className="text-5xl font-bold text-surface-900 mb-2">Free</p>
              <p className="text-surface-400 text-sm mb-8">
                No card required for the private beta.
              </p>
              <Link
                href="/auth/signup?role=developer"
                className="block w-full text-center bg-surface-900 hover:bg-surface-700 text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors mb-8"
              >
                Join beta →
              </Link>
              <ul className="space-y-4">
                {DEVELOPER_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-surface-700">
                    <span className="text-emerald-500 shrink-0">
                      <IconCheck />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-surface-900 rounded-2xl p-8 relative overflow-hidden">
              <p className="text-xs uppercase tracking-wider text-brand-300 font-semibold mb-4">
                Advertisers
              </p>
              <p className="text-4xl font-bold text-white mb-2">Review access</p>
              <p className="text-white/60 text-sm mb-8">
                Create and inspect campaigns without enabling live spend.
              </p>
              <Link
                href="/auth/signup?role=advertiser"
                className="block w-full text-center bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors mb-8"
              >
                Join advertiser beta →
              </Link>
              <ul className="space-y-4">
                {ADVERTISER_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-white">
                    <span className="text-emerald-400 shrink-0">
                      <IconCheck />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="py-20 px-6 bg-surface-50/70">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-3xl font-bold text-surface-900 tracking-tight text-center mb-4">
              How money will move after approval
            </h2>
            <p className="text-surface-500 text-center max-w-2xl mx-auto mb-12">
              Advertiser billing and participant compensation are intentionally separate. There is
              no automatic customer-payment split.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border border-surface-200 rounded-2xl p-7">
                <p className="text-xs uppercase tracking-wider text-surface-400 mb-3">Money in</p>
                <h3 className="font-semibold text-surface-900 text-lg mb-3">
                  Advertiser → Dodo → Ateva
                </h3>
                <p className="text-surface-600 text-sm leading-relaxed">
                  An advertiser purchases campaign delivery from Ateva. Dodo Payments handles that
                  customer transaction and settles it to Ateva. Dodo does not pay participants.
                </p>
              </div>
              <div className="bg-white border border-surface-200 rounded-2xl p-7">
                <p className="text-xs uppercase tracking-wider text-surface-400 mb-3">Money out</p>
                <h3 className="font-semibold text-surface-900 text-lg mb-3">
                  Ateva → separate payout provider → participant
                </h3>
                <p className="text-surface-600 text-sm leading-relaxed">
                  If rewards launch, Ateva independently calculates eligible fiat compensation after
                  verification and pays it through a separately approved payout provider.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 px-6">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-bold text-surface-900 text-center mb-4">
              Current beta controls
            </h2>
            <p className="text-surface-500 text-center text-sm mb-10">
              These values describe policy/configuration, not currently available real-money
              actions.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Minimum deposit policy', value: minDeposit },
                { label: 'Minimum payout policy', value: minPayout },
                { label: 'Configured currencies', value: supportedCurrencies.join(', ') },
                { label: 'Beta money state', value: 'Disabled' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-surface-50 rounded-xl p-5 text-center border border-surface-100"
                >
                  <p className="text-surface-400 text-[11px] uppercase tracking-wider mb-2">
                    {item.label}
                  </p>
                  <p className="text-surface-900 font-semibold text-sm">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 px-6 bg-surface-900 text-white">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold mb-4">Validate the product before monetization</h2>
            <p className="text-white/60 mb-8">
              The beta is designed to prove the wait-state signal, advertiser workflow, fraud
              controls, and reporting before any participant reward or live campaign billing is
              enabled.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/auth/signup?role=developer"
                className="rounded-lg bg-white text-surface-900 px-5 py-3 text-sm font-semibold"
              >
                Join developer beta
              </Link>
              <Link
                href="/auth/signup?role=advertiser"
                className="rounded-lg border border-white/30 px-5 py-3 text-sm font-semibold text-white"
              >
                Review advertiser tooling
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
