import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Ateva',
  description:
    'Ateva terms of service — developer and advertiser obligations, fraud policy, and payout terms.',
};

export default function TermsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-white px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 text-sm font-medium mb-8 transition-colors"
        >
          ← Back to home
        </Link>
        <h1 className="font-serif text-4xl md:text-[44px] font-normal leading-[1.15] tracking-[-0.015em] text-surface-950 mb-10">
          Terms of Service
        </h1>

        <div className="mb-10 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-semibold">Private beta</p>
          <p className="mt-1 text-sm leading-relaxed">
            Advertiser billing and participant rewards are disabled during the private beta. The
            compensation and payout sections below describe the planned launch policy, not an active
            entitlement.
          </p>
        </div>
        <div className="text-surface-600 text-sm leading-relaxed space-y-6">
          <p>
            <strong className="text-surface-900">Last updated:</strong> July 2026
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">1. Acceptance</h2>
          <p>
            By using Ateva, you agree to these terms. If you disagree, please do not use the
            service.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">
            2. Service description
          </h2>
          <p>
            Ateva is currently a privacy-first private beta for AI tool wait-state verification.
            Rewards and advertiser billing are disabled during the beta. If rewards are approved and
            enabled, developers may receive compensation for verified eligible activity under a
            separately published schedule, and advertisers may reach a high-intent developer
            audience.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">
            3. Developer obligations
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Do not artificially inflate impressions or clicks</li>
            <li>Do not use automated tools, bots, or scripts to simulate ad interactions</li>
            <li>Do not click on your own advertiser campaigns</li>
            <li>Report suspicious activity through the extension</li>
          </ul>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">
            4. Advertiser obligations
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Ads must not contain malware, phishing, or deceptive content</li>
            <li>Destination URLs must match the displayed domain</li>
            <li>Budget commitments are binding once a campaign is activated</li>
          </ul>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">5. Fraud policy</h2>
          <p>
            Fraudulent activity will result in earnings reversal, account restriction, and potential
            legal action. We use automated detection and manual review to protect platform
            integrity.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">
            6. Participant compensation
          </h2>
          <p>
            Participant rewards are disabled during the private beta. If rewards launch, the rate is
            60% of the qualifying bid for a verified impression, with the remaining 40% retained by
            Ateva. That amount is calculated and owed by Ateva; it is not a claim on any individual
            advertiser payment. An advertiser transaction settles in full to Ateva, and participant
            compensation is a separate Ateva obligation discharged through a different provider. See
            the{' '}
            <Link href="/payout-policy" className="text-brand-700 font-medium hover:underline">
              Payout Policy
            </Link>{' '}
            for the full schedule.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">7. Payout terms</h2>
          <p>
            No payouts are processed during the private beta. Under the planned launch policy,
            confirmed eligible rewards must reach the published minimum threshold, new accounts are
            subject to a 30-day hold period, and processing times vary by the approved payout
            provider. Dodo Payments processes advertiser transactions only and is not used to
            distribute participant rewards.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">8. Disclaimer</h2>
          <p>
            Ateva is provided "as is" without warranty. We are not liable for any losses from
            service interruptions, fraud, or payment processing delays.
          </p>
        </div>
      </div>
    </main>
  );
}
