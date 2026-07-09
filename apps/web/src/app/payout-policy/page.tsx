import type { Metadata } from 'next';
import Link from 'next/link';

import { CURRENCY_POLICY, formatMinorUnits, payoutMinimumMinor } from '@waitlayer/shared';

export const metadata: Metadata = {
  title: 'Payout Policy — WaitLayer',
  description:
    'WaitLayer payout policy — earnings release, payout methods, minimum payout, and revenue split details.',
};

export default function PayoutPolicyPage() {
  const minPayout = formatMinorUnits(payoutMinimumMinor('USD'), 'USD');
  const supportedCurrencies = Object.keys(CURRENCY_POLICY);
  return (
    <div className="min-h-screen bg-surface-50">
      <nav className="glass-nav border-b border-surface-200/60 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">
              WaitLayer
            </span>
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-surface-900 mb-8 tracking-tight">Payout Policy</h1>

        <div className="prose prose-surface max-w-none">
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">1. Earnings Release</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Developer earnings are categorized in three states: estimated, confirmed, and held.
              Earnings become available for payout after passing a hold period (3 days for new
              accounts, longer for higher trust levels). Held earnings are released after fraud
              investigation completes.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">2. Payout Methods</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Payouts are processed via PayPal (manual, supported today) and additional methods are
              planned for launch. Each user can register one payout account per provider. Inactive
              accounts can be reactivated through account settings.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">3. Minimum Payout</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Minimum payout threshold is {minPayout} (or currency equivalent) in confirmed
              earnings. Payouts are supported in multiple currencies (
              {supportedCurrencies.join(', ')}); amounts below the threshold remain in your balance
              and aggregate with future earnings.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">4. Revenue Split</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Standard revenue split is 60% to the developer, 30% to the platform, and 10% to the
              fraud and payment reserve. A promotional launch split (e.g. 80/10/10) may apply only
              when explicitly enabled by the operator; the standard split applies otherwise. All
              splits are calculated automatically per qualified impression or click.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">5. Fraud Review Hold</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Earnings related to fraudulent activity (self-clicking, duplicate impressions, etc.)
              may be reversed. Trust score penalties apply to accounts with confirmed fraud flags.
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
