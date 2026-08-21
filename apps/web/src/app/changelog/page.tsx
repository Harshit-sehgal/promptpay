import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Changelog — Ateva',
  description: 'Ateva release history, feature updates, improvements, and system patches.',
};

export default function ChangelogPage() {
  const releases = [
    {
      version: 'v1.1.0',
      date: 'July 2026',
      title: 'Automated Payouts & Enhanced DSP Controls',
      changes: [
        'Integrated automated PayPal Payouts & Wise provider endpoints.',
        'Moved payout-provider availability to authenticated runtime readiness and fail-closed operator controls.',
        'Introduced server-side country targeting and DSP reservation validations.',
        'Refactored frontend to support full-page static builds and hydration checks.',
      ],
    },
    {
      version: 'v1.0.0',
      date: 'June 2026',
      title: 'Public Launch',
      changes: [
        'Released official VS Code extension supporting Cursor, Windsurf, and Cline.',
        'Released Ateva CLI tool for terminal-based developer environments.',
        'Shipped full advertiser dashboard with real-time budget, click, and impression analytics.',
        'Completed privacy audits ensuring 100% compliance with local allowlist rules.',
      ],
    },
  ];

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-white px-6 py-20">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 text-sm font-medium mb-8 transition-colors"
        >
          ← Back to home
        </Link>
        <h1 className="font-serif text-[42px] font-normal text-surface-900 tracking-tight mb-10">
          Changelog
        </h1>
        <div className="space-y-12">
          {releases.map((release) => (
            <div
              key={release.version}
              style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: '32px' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '12px',
                  flexWrap: 'wrap',
                  marginBottom: '16px',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono), ui-monospace, monospace',
                    fontSize: '14px',
                    fontWeight: 600,
                    // --accent (#16a34a) measures 3.30:1 on white and fails WCAG AA
                    // for 14px text. --accent-strong is the existing token for
                    // accent-coloured TEXT and clears it comfortably.
                    color: 'var(--accent-strong, #087443)',
                  }}
                >
                  {release.version}
                </span>
                <span style={{ fontSize: '13px', color: '#6b6b6b' }}>{release.date}</span>
                <h2
                  style={{
                    fontSize: '20px',
                    fontWeight: 600,
                    color: '#111',
                    width: '100%',
                    marginTop: '6px',
                  }}
                >
                  {release.title}
                </h2>
              </div>
              <ul
                style={{
                  listStyle: 'disc',
                  paddingLeft: '20px',
                  fontSize: '14.5px',
                  color: '#555',
                  lineHeight: '1.7',
                }}
                className="space-y-2"
              >
                {release.changes.map((change, idx) => (
                  <li key={idx}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
