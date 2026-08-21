import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Advertiser Policy — WaitLayer',
  description:
    'WaitLayer advertiser policy — eligibility, sponsored-content guidelines, campaign billing, verified delivery, and fraud prevention.',
};

export default function AdvertiserPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-50">
      <nav className="glass-nav border-b border-surface-200/60 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-sm tracking-tight">WaitLayer</span>
          </Link>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-surface-900 mb-8 tracking-tight">
          Advertiser Policy
        </h1>

        <div className="mb-10 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-semibold">Private beta</p>
          <p className="mt-1 text-sm leading-relaxed">
            Campaign tooling can be reviewed during beta, but live advertiser billing and reward
            payouts stay disabled until their production approvals are complete.
          </p>
        </div>

        <div className="prose prose-surface max-w-none">
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">1. Eligibility</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Advertisers must provide accurate information and comply with applicable laws and
              WaitLayer content rules. WaitLayer may reject or remove campaigns that fail review.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">2. Sponsored content</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Sponsored units must be truthful, non-deceptive, relevant to approved developer-tool
              environments, and visibly labeled as sponsored content. Creatives are reviewed before
              activation.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">3. Campaign billing</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              When live billing is approved, an advertiser purchases campaign delivery from
              WaitLayer. Dodo Payments processes the advertiser transaction and the payment is
              settled to WaitLayer. Dodo Payments does not split that transaction with participants
              and does not maintain participant reward balances.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">
              4. Participant compensation
            </h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Any future participant compensation is calculated independently by WaitLayer after
              eligible activity is verified. It is paid from WaitLayer through a separate payout
              provider. The participant reward schedule is not an ownership percentage of an
              individual advertiser payment.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">
              5. Verified delivery and fraud
            </h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Advertiser reporting uses eligible rendered impressions and clicks that pass the
              applicable session, visibility, duplicate, budget, and fraud controls. Invalid or
              duplicate activity is excluded from qualified delivery.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">6. Account suspension</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              WaitLayer may suspend advertiser accounts or campaigns for policy violations,
              fraudulent activity, deceptive creatives, or attempts to bypass platform controls.
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
