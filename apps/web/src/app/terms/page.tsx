import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — WaitLayer',
  description:
    'WaitLayer terms of service — developer and advertiser obligations, fraud policy, and payout terms.',
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
        <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-10">
          Terms of Service
        </h1>
        <div className="text-surface-600 text-sm leading-relaxed space-y-6">
          <p>
            <strong className="text-surface-900">Last updated:</strong> July 2026
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">1. Acceptance</h2>
          <p>
            By using WaitLayer, you agree to these terms. If you disagree, please do not use the
            service.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">
            2. Service description
          </h2>
          <p>
            WaitLayer is currently a privacy-first private beta for AI tool wait-state verification.
            Rewards and advertiser billing are disabled during the beta. Once independently
            attestable rewards are enabled, developers may earn from validated ad impressions and
            advertisers may reach a high-intent developer audience.
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

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">6. Revenue sharing</h2>
          <p>
            Developers receive 60% of ad revenue (80% during launch incentive period). The platform
            retains 30% (10% during launch) with 10% allocated to fraud and payment reserves.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">7. Payout terms</h2>
          <p>
            Earnings must reach the minimum threshold to be eligible for payout. New accounts are
            subject to a 30-day hold period. Payout processing times vary by provider.
          </p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">8. Disclaimer</h2>
          <p>
            WaitLayer is provided "as is" without warranty. We are not liable for any losses from
            service interruptions, fraud, or payment processing delays.
          </p>
        </div>
      </div>
    </main>
  );
}
