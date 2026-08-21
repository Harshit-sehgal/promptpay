import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Manifesto — WaitLayer',
  description:
    'WaitLayer Manifesto — developer attention is respected, privacy is non-negotiable, and participant compensation must be transparent and independently defined.',
};

export default function ManifestoPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-white px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 text-sm font-medium mb-8 transition-colors"
        >
          ← Back to home
        </Link>
        <h1
          className="text-4.5xl font-bold text-surface-900 tracking-tight mb-10"
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: '42px',
            fontWeight: 400,
          }}
        >
          The WaitLayer Manifesto
        </h1>
        <div className="text-surface-600 text-sm leading-relaxed space-y-6">
          <p
            className="text-lg text-surface-800 italic"
            style={{
              fontSize: '18px',
              color: '#111',
              borderLeft: '3px solid var(--accent, #16a34a)',
              paddingLeft: '16px',
            }}
          >
            “Developer attention should be respected. Privacy is absolute. Any reward system must be
            transparent, verifiable, and separate from customer payment custody.”
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            1. Attention is a scarce resource
          </h2>
          <p>
            AI coding agents, builds, tests, and deployments create natural waiting periods.
            WaitLayer is exploring whether a small, clearly labeled sponsor surface can fit those
            moments without interrupting the developer or pretending to be part of the agent output.
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            2. Privacy is non-negotiable
          </h2>
          <p>
            WaitLayer does not need source code, prompts, terminal output, file contents, secrets,
            or repository names to verify an eligible wait state. The product is designed around a
            narrow telemetry allowlist and explicit user consent.
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            3. Compensation should be explicit, not pass-through
          </h2>
          <p>
            If participant rewards launch, WaitLayer will publish a reward schedule based on
            verified eligible activity. That schedule is independent from advertiser campaign
            pricing. Advertisers purchase a service from WaitLayer; WaitLayer separately bears the
            cost of participant compensation through an approved fiat payout provider.
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            4. Verification comes before monetization
          </h2>
          <p>
            The private beta is telemetry-only. Rewards and live campaign billing remain disabled
            until the relevant verification, fraud, payment, and payout controls are independently
            reviewed and production-ready.
          </p>
        </div>
      </div>
    </main>
  );
}
