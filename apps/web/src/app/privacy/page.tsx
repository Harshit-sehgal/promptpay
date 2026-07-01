import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 text-[14px] font-medium mb-8 transition-colors">
          ← Back to home
        </Link>
        <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-10">Privacy Policy</h1>
        <div className="text-surface-600 text-[15px] leading-relaxed space-y-6">
          <p><strong className="text-surface-900">Last updated:</strong> July 2026</p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">1. What we collect</h2>
          <p>WaitLayer is privacy-first. We <strong className="text-surface-900">never</strong> collect your source code, AI prompts, completions, file names, clipboard contents, terminal commands, or project names from your device.</p>
          <p>We collect only what is necessary to operate the service:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Account information (email, name)</li>
            <li>Device fingerprint hash (for fraud prevention — never the raw fingerprint)</li>
            <li>Ad interaction events (impressions, clicks) validated against fraud checks</li>
            <li>Payout destination (PayPal email or other payment account)</li>
            <li>IP address hashes (one-way SHA-256, never stored in plain text)</li>
          </ul>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">2. How we use your data</h2>
          <p>Your data is used exclusively to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Calculate your earnings and trust score</li>
            <li>Prevent fraud and abuse</li>
            <li>Process payouts</li>
            <li>Maintain platform security</li>
          </ul>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">3. Data retention</h2>
          <p>Impression and click records are retained for 90 days for audit purposes. Earnings and payout records are retained indefinitely for accounting compliance. You can request deletion of your account at any time.</p>

          <h2 className="text-xl font-semibold text-surface-900 mt-10 mb-3">4. Your rights</h2>
          <p>You have the right to access, correct, or delete your personal data. Contact support@waitlayer.com for any data requests.</p>
        </div>
      </div>
    </div>
  );
}
