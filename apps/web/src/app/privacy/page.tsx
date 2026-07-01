export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-ink-900 px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Privacy Policy</h1>
        <div className="text-ink-300 text-sm leading-relaxed space-y-6">
          <p><strong className="text-white">Last updated:</strong> July 2026</p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">1. What we collect</h2>
          <p>WaitLayer is privacy-first. We <strong className="text-white">never</strong> collect your source code, AI prompts, completions, file names, clipboard contents, terminal commands, or project names from your device.</p>
          <p>We collect only what is necessary to operate the service:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Account information (email, name)</li>
            <li>Device fingerprint hash (for fraud prevention — never the raw fingerprint)</li>
            <li>Ad interaction events (impressions, clicks) validated against fraud checks</li>
            <li>Payout destination (PayPal email or other payment account)</li>
            <li>IP address hashes (one-way SHA-256, never stored in plain text)</li>
          </ul>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">2. How we use your data</h2>
          <p>Your data is used exclusively to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Calculate your earnings and trust score</li>
            <li>Prevent fraud and abuse</li>
            <li>Process payouts</li>
            <li>Maintain platform security</li>
          </ul>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">3. Data retention</h2>
          <p>Impression and click records are retained for 90 days for audit purposes. Earnings and payout records are retained indefinitely for accounting compliance. You can request deletion of your account at any time.</p>

          <h2 className="text-xl font-semibold text-white mt-8 mb-3">4. Your rights</h2>
          <p>You have the right to access, correct, or delete your personal data. Contact support@waitlayer.com for any data requests.</p>
        </div>
      </div>
    </div>
  );
}
