import Link from 'next/link';

export default function AdvertiserPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-50">
      <nav className="glass-nav border-b border-surface-200/60 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">W</div>
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-surface-900 mb-8 tracking-tight">Advertiser Policy</h1>

        <div className="prose prose-surface max-w-none">
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">1. Eligibility</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Advertisers must provide accurate business information and comply with all applicable laws and regulations.
              We reserve the right to reject or remove any advertiser account that violates these policies.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">2. Ad Content Guidelines</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              All ad creatives must be truthful, non-deceptive, and clearly labeled as sponsored content.
              Prohibited categories include but are not limited to: malware, phishing, illegal substances,
              adult content, and gambling. All creatives are subject to review before activation.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">3. Billing and Payments</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              Advertisers are billed per impression and per click based on their selected bid model.
              All funds are deposited via Stripe before campaigns go live. Unused budget remains in
              the advertiser balance and can be used for future campaigns or refunded upon request.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">4. Fraud Prevention</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              WaitLayer employs automated fraud detection systems. Invalid impressions and clicks
              (self-clicking, bot traffic, duplicate clicks) are not billed. We reserve the right
              to adjust billing based on fraud investigation outcomes.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold text-surface-900 mb-4">5. Account Suspension</h2>
            <p className="text-surface-600 leading-relaxed mb-4">
              We may suspend or terminate advertiser accounts that violate these policies, engage in
              fraudulent activity, or create a poor experience for developers. Suspended accounts
              will receive written notice and an opportunity to appeal.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-surface-200">
          <Link href="/" className="text-brand-500 hover:text-brand-600 font-medium transition-colors">
            Return to homepage
          </Link>
        </div>
      </main>
    </div>
  );
}
