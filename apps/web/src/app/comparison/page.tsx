import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Tool Comparison — WaitLayer',
  description: 'WaitLayer supports VS Code, Cursor, Windsurf, Cline, Claude Code, and terminal. Compare features across platforms.',
};

const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconMinus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
);
const TOOLS = [
  { name: 'VS Code Extension', slug: 'vscode', status: 'live', badge: 'Live' },
  { name: 'Cursor', slug: 'cursor', status: 'live', badge: 'Live' },
  { name: 'Windsurf', slug: 'windsurf', status: 'live', badge: 'Live' },
  { name: 'Cline (VS Code)', slug: 'cline', status: 'live', badge: 'Live' },
  { name: 'Claude Code (CLI)', slug: 'claude-code', status: 'live', badge: 'Live' },
  { name: 'Terminal (CLI)', slug: 'terminal', status: 'live', badge: 'Live' },
  { name: 'Aider', slug: 'aider', status: 'planned', badge: 'Planned' },
  { name: 'Codex CLI', slug: 'codex-cli', status: 'planned', badge: 'Planned' },
];

const TOOL_FEATURES = [
  { label: 'Wait state detection', vscode: true, cursor: true, windsurf: true, cline: true, claude: true, terminal: true },
  { label: 'Ad display during waits', vscode: true, cursor: true, windsurf: true, cline: true, claude: true, terminal: true },
  { label: 'Opt-in ad clicks', vscode: true, cursor: true, windsurf: true, cline: true, claude: true, terminal: true },
  { label: 'Earnings tracking', vscode: true, cursor: true, windsurf: true, cline: true, claude: true, terminal: true },
  { label: 'Quiet mode scheduling', vscode: true, cursor: true, windsurf: true, cline: true, claude: false, terminal: false },
  { label: 'Ad frequency controls', vscode: true, cursor: true, windsurf: true, cline: true, claude: true, terminal: true },
];

const PLATFORM_COMPARE = [
  { feature: 'Privacy-first (no code/prompt tracking)', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'Developer-targeted ad network', waitlayer: true, carbon: true, braze: false, google: false },
  { feature: 'AI wait state monetization', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'Fraud-resistant trust scoring', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'Transparent revenue split (60% dev)', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'PayPal-first global payouts', waitlayer: true, carbon: true, braze: false, google: false },
  { feature: 'Self-serve campaign creation', waitlayer: true, carbon: true, braze: true, google: true },
  { feature: 'Real-time invalid traffic filtering', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'Open-source extension', waitlayer: true, carbon: false, braze: false, google: false },
  { feature: 'Multiple tool support (IDE + CLI)', waitlayer: true, carbon: false, braze: true, google: false },
];

export default function ComparisonPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">W</div>
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <Link href="/pricing" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">Pricing</Link>
            <Link href="/comparison" className="text-surface-900 font-medium text-[14px]">Comparison</Link>
            <Link href="/#how-it-works" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">How it works</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="text-surface-600 hover:text-surface-900 text-[14px] font-medium transition-colors px-3 py-1.5">Log in</Link>
            <Link href="/auth/signup" className="bg-surface-900 hover:bg-surface-700 text-white text-[14px] font-medium px-4 py-2 rounded-lg transition-colors">Get started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-16 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
            Tool & platform comparison
          </h1>
          <p className="text-surface-500 text-lg max-w-xl mx-auto">
            See which tools WaitLayer supports and how we compare to other ad platforms.
          </p>
        </div>
      </section>

      {/* Supported tools */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-surface-900 tracking-tight mb-3">Supported tools</h2>
          <p className="text-surface-500 text-[15px] mb-8">WaitLayer integrates directly into popular AI coding tools as a VS Code extension or terminal CLI.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TOOLS.map((tool) => (
              <div key={tool.slug} className="bg-white border border-surface-200/80 rounded-xl p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-surface-900 font-semibold text-[15px]">{tool.name}</p>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    tool.status === 'live'
                      ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                      : 'text-amber-600 bg-amber-50 border-amber-200'
                  }`}>
                    {tool.badge}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature matrix by tool */}
      <section className="py-20 px-6 bg-surface-50/60">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-surface-900 tracking-tight mb-3">Features by tool</h2>
          <p className="text-surface-500 text-[15px] mb-8">Not all tools support every feature. Here's what's available for each integration.</p>
          <div className="overflow-hidden rounded-2xl border border-surface-200/80">
            <table className="w-full text-[14px]">
              <thead className="bg-surface-100">
                <tr>
                  <th className="text-left px-5 py-4 text-surface-600 font-medium">Feature</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">VS Code</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">Cursor</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">Windsurf</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">Cline</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">Claude Code</th>
                  <th className="text-center px-3 py-4 text-surface-600 font-medium">Terminal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {TOOL_FEATURES.map((f) => (
                  <tr key={f.label} className="hover:bg-surface-50/50 transition-colors">
                    <td className="px-5 py-4 text-surface-700">{f.label}</td>
                    {[f.vscode, f.cursor, f.windsurf, f.cline, f.claude, f.terminal].map((supported, i) => (
                      <td key={i} className="text-center px-3 py-4">
                        <span className={supported ? 'text-emerald-500' : 'text-surface-300'}>
                          {supported ? <IconCheck /> : <IconMinus />}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Platform comparison */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold text-surface-900 tracking-tight mb-3">How we compare</h2>
          <p className="text-surface-500 text-[15px] mb-8">WaitLayer vs other ad platforms. We focus on privacy, developer trust, and AI-native integrations.</p>
          <div className="overflow-hidden rounded-2xl border border-surface-200/80">
            <table className="w-full text-[14px]">
              <thead className="bg-surface-100">
                <tr>
                  <th className="text-left px-5 py-4 text-surface-600 font-medium w-1/3">Feature</th>
                  <th className="text-center px-3 py-4 text-brand-600 font-semibold">WaitLayer</th>
                  <th className="text-center px-3 py-4 text-surface-400 font-medium">Carbon Ads</th>
                  <th className="text-center px-3 py-4 text-surface-400 font-medium">Braze</th>
                  <th className="text-center px-3 py-4 text-surface-400 font-medium">Google Ads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {PLATFORM_COMPARE.map((row) => (
                  <tr key={row.feature} className="hover:bg-surface-50/50 transition-colors">
                    <td className="px-5 py-4 text-surface-700">{row.feature}</td>
                    {[row.waitlayer, row.carbon, row.braze, row.google].map((supported, i) => (
                      <td key={i} className="text-center px-3 py-4">
                        <span className={supported ? 'text-emerald-500' : 'text-surface-300'}>
                          {supported ? <IconCheck /> : <IconMinus />}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 bg-brand-500">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white tracking-tight mb-4">
            Start earning with WaitLayer
          </h2>
          <p className="text-white/80 text-[15px] mb-8 max-w-sm mx-auto">
            Install the extension or CLI in under 2 minutes. No credit card required.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/auth/signup" className="bg-white hover:bg-surface-50 text-surface-900 font-medium px-7 py-3 rounded-xl text-[15px] transition-colors shadow-sm">
              Sign up free →
            </Link>
            <Link href="/pricing" className="text-white/90 hover:text-white font-medium px-5 py-3 text-[15px] transition-colors">
              View pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-surface-200/60">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-start justify-between gap-10">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center text-white font-bold text-[10px]">W</div>
                <span className="text-surface-900 font-semibold text-[14px]">WaitLayer</span>
              </div>
              <p className="text-surface-400 text-[14px] max-w-xs leading-relaxed">Privacy-first reward marketplace for AI coding assistant wait states.</p>
            </div>
            <div className="flex gap-16">
              <div>
                <h4 className="text-surface-900 font-semibold text-[13px] mb-3">Product</h4>
                <div className="flex flex-col gap-2">
                  <Link href="/pricing" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Pricing</Link>
                  <Link href="/comparison" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Comparison</Link>
                  <Link href="/#how-it-works" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">How it works</Link>
                </div>
              </div>
              <div>
                <h4 className="text-surface-900 font-semibold text-[13px] mb-3">Legal</h4>
                <div className="flex flex-col gap-2">
                  <Link href="/privacy" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Privacy</Link>
                  <Link href="/terms" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Terms</Link>
                  <Link href="/advertiser-policy" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Advertiser Policy</Link>
                  <Link href="/payout-policy" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Payout Policy</Link>
                  <Link href="/contact" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Contact</Link>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t border-surface-100 text-surface-400 text-[13px]">© 2026 WaitLayer. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
