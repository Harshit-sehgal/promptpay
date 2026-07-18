import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Manifesto — WaitLayer',
  description:
    'WaitLayer Manifesto — developer attention is sacred, privacy is non-negotiable, and creators deserve 70% of the value they generate.',
};

export default function ManifestoPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-white px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 text-[14px] font-medium mb-8 transition-colors"
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
        <div className="text-surface-600 text-[15px] leading-relaxed space-y-6">
          <p
            className="text-lg text-surface-800 italic"
            style={{
              fontSize: '18px',
              color: '#111',
              borderLeft: '3px solid var(--accent, #16a34a)',
              paddingLeft: '16px',
            }}
          >
            "Developer attention is sacred. Privacy is absolute. Revenue should go to those who
            build, not just those who distribute."
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            1. Attention is the Ultimate Resource
          </h2>
          <p>
            In the modern era of software engineering, we spend hours waiting for AI coding models,
            builds, tests, and deployments to compile. This wait state is a highly valuable
            micro-moment of human attention. We believe developers should own this attention and get
            rewarded directly for it, rather than having it sold behind their backs.
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            2. Privacy is Non-Negotiable
          </h2>
          <p>
            Ad networks have historically spied on users, tracked search histories, and read local
            files. We reject this. WaitLayer does not inspect your code, does not record your
            prompts, and does not capture your terminal context. We enforce a strictly-governed,
            local allowlist that guarantees zero personal data or source code ever leaves your
            machine.
          </p>

          <h2
            className="text-xl font-semibold text-surface-900 mt-10 mb-3"
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: '28px',
              fontWeight: 400,
            }}
          >
            3. The 70% Revenue Share Standard
          </h2>
          <p>
            Platforms take too much. We commit to a permanent model where the developers receive 70%
            of every sponsor dollar spent. By rewarding engineers fairly, we build a sustainable
            attention marketplace where sponsors reach highly-engaged professionals, and builders
            offset their tooling costs.
          </p>
        </div>
      </div>
    </main>
  );
}
