import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing — WaitLayer',
  description: 'WaitLayer pricing — free for developers, transparent CPM/CPC for advertisers. No hidden fees.',
};

const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconMinus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
);

const PLAN_FEATURES = [
  { label: 'Installation & setup', dev: true, adv: true },
  { label: 'Earn from wait states', dev: true, adv: false },
  { label: 'PayPal payouts', dev: true, adv: false },
  { label: 'Trust score & fraud protection', dev: true, adv: true },
  { label: 'Ad frequency & quiet mode controls', dev: true, adv: false },
  { label: 'Campaign creation & management', dev: false, adv: true },
  { label: 'Country & tool targeting', dev: false, adv: true },
  { label: 'Real-time performance reports', dev: false, adv: true },
  { label: 'Invalid traffic credits', dev: false, adv: true },
  { label: 'Priority support', dev: false, adv: false },
  { label: 'API access', dev: false, adv: false },
  { label: 'Custom integrations', dev: false, adv: false },
];

export default function PricingPage() {
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
            <Link href="/pricing" className="text-surface-900 font-medium text-[14px]">Pricing</Link>
            <Link href="/comparison" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">Comparison</Link>
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
            Simple, transparent pricing
          </h1>
          <p className="text-surface-500 text-lg max-w-xl mx-auto">
            Free for developers. Performance-based CPM/CPC for advertisers. No surprise fees.
          </p>
        </div>
      </section>

      {/* Pricing cards */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Developer */}
          <div className="bg-white border-2 border-surface-200/80 rounded-2xl p-8 relative">
            <div className="inline-flex items-center gap-1.5 bg-brand-50 border border-brand-200/60 rounded-full px-3 py-1 text-brand-600 text-[11px] font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
              For developers
            </div>
            <p className="text-5xl font-bold text-surface-900 mb-2">Free</p>
            <p className="text-surface-400 text-[14px] mb-8">Always. No credit card needed.</p>
            <Link
              href="/auth/signup"
              className="block w-full text-center bg-surface-900 hover:bg-surface-700 text-white font-medium px-6 py-3 rounded-xl text-[15px] transition-colors mb-8"
            >
              Start earning →
            </Link>
            <ul className="space-y-4">
              {PLAN_FEATURES.map((f) => (
                <li key={f.label} className={`flex items-center gap-3 text-[14px] ${f.dev ? 'text-surface-700' : 'text-surface-400'}`}>
                  <span className={f.dev ? 'text-emerald-500 shrink-0' : 'text-surface-300 shrink-0'}>
                    {f.dev ? <IconCheck /> : <IconMinus />}
                  </span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>

          {/* Advertiser */}
          <div className="bg-surface-900 rounded-2xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
            <div className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-white text-[11px] font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              For advertisers
            </div>
            <p className="text-5xl font-bold text-white mb-2">
              $0.50<span className="text-lg text-white/50 font-normal"> minimum bid</span>
            </p>
            <p className="text-white/50 text-[14px] mb-8">CPM or CPC bidding. Only pay for valid traffic.</p>
            <Link
              href="/auth/signup"
              className="block w-full text-center bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-3 rounded-xl text-[15px] transition-colors mb-8"
            >
              Start advertising →
            </Link>
            <ul className="space-y-4">
              {PLAN_FEATURES.map((f) => (
                <li key={f.label} className={`flex items-center gap-3 text-[14px] ${f.adv ? 'text-white' : 'text-white/30'}`}>
                  <span className={f.adv ? 'text-emerald-400 shrink-0' : 'text-white/20 shrink-0'}>
                    {f.adv ? <IconCheck /> : <IconMinus />}
                  </span>
                  {f.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Revenue split detail */}
      <section className="py-24 px-6 bg-surface-50/60">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold text-surface-900 tracking-tight text-center mb-5">
            Where your money goes
          </h2>
          <p className="text-surface-500 text-center max-w-lg mx-auto mb-16">
            Every dollar from advertiser spend is split transparently.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <p className="text-5xl font-bold text-brand-500 mb-2">60%</p>
              <p className="text-surface-900 font-semibold mb-2">Developer revenue share</p>
              <p className="text-surface-500 text-[14px]">The developer earns the majority. Their attention drives the marketplace.</p>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <p className="text-5xl font-bold text-surface-900 mb-2">30%</p>
              <p className="text-surface-900 font-semibold mb-2">Platform fee</p>
              <p className="text-surface-500 text-[14px]">Infrastructure, fraud detection, payment processing, and support.</p>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <p className="text-5xl font-bold text-surface-400 mb-2">10%</p>
              <p className="text-surface-900 font-semibold mb-2">Reserve fund</p>
              <p className="text-surface-500 text-[14px]">Fraud reserve, payment failures, and disputed charges buffer.</p>
            </div>
          </div>
          <div className="mt-10 text-center">
            <p className="text-surface-400 text-[14px]">Launch incentive: developers earn <strong className="text-surface-600">80%</strong> for the first 3 months.</p>
          </div>
        </div>
      </section>

      {/* Payout thresholds */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold text-surface-900 tracking-tight text-center mb-5">
            Payout schedules
          </h2>
          <p className="text-surface-500 text-center max-w-lg mx-auto mb-16">
            Payment speed depends on your trust level. Higher trust = faster payouts.
          </p>
          <div className="overflow-hidden rounded-2xl border border-surface-200/80">
            <table className="w-full text-[14px]">
              <thead className="bg-surface-100">
                <tr>
                  <th className="text-left px-6 py-4 text-surface-600 font-medium">Trust level</th>
                  <th className="text-left px-6 py-4 text-surface-600 font-medium">Hold period</th>
                  <th className="text-left px-6 py-4 text-surface-600 font-medium">Minimum payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                <tr className="hover:bg-surface-50/50 transition-colors">
                  <td className="px-6 py-4 text-surface-900 font-medium">High trust</td>
                  <td className="px-6 py-4 text-surface-600">7 days</td>
                  <td className="px-6 py-4 text-surface-600">$10.00</td>
                </tr>
                <tr className="hover:bg-surface-50/50 transition-colors">
                  <td className="px-6 py-4 text-surface-900 font-medium">Normal</td>
                  <td className="px-6 py-4 text-surface-600">14 days</td>
                  <td className="px-6 py-4 text-surface-600">$10.00</td>
                </tr>
                <tr className="hover:bg-surface-50/50 transition-colors">
                  <td className="px-6 py-4 text-surface-900 font-medium">New account</td>
                  <td className="px-6 py-4 text-surface-600">30 days</td>
                  <td className="px-6 py-4 text-surface-600">$10.00</td>
                </tr>
                <tr className="hover:bg-surface-50/50 transition-colors">
                  <td className="px-6 py-4 text-surface-900 font-medium">Low trust</td>
                  <td className="px-6 py-4 text-surface-600">Extended review</td>
                  <td className="px-6 py-4 text-surface-600">$10.00</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Minimum deposit', value: '$50' },
              { label: 'Payout currency', value: 'USD' },
              { label: 'Launch split (first 3mo)', value: '80/10/10' },
              { label: 'Platform reserve', value: '10%' },
            ].map((item) => (
              <div key={item.label} className="bg-surface-50 rounded-xl p-4 text-center">
                <p className="text-surface-400 text-[12px] uppercase tracking-wider mb-1">{item.label}</p>
                <p className="text-surface-900 font-semibold text-[15px]">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Payout providers */}
      <section className="py-20 px-6 bg-surface-50/60">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold text-surface-900 tracking-tight text-center mb-3">
            Payment providers
          </h2>
          <p className="text-surface-500 text-center text-[15px] mb-12">
            We start with PayPal and expand from there.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'PayPal', status: 'Live', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
              { name: 'Stripe Connect', status: 'Coming Q3', color: 'text-amber-600 bg-amber-50 border-amber-200' },
              { name: 'Payoneer', status: 'Planned', color: 'text-surface-400 bg-surface-100 border-surface-200' },
              { name: 'Wise', status: 'Planned', color: 'text-surface-400 bg-surface-100 border-surface-200' },
            ].map((p) => (
              <div key={p.name} className="bg-white border border-surface-200/80 rounded-xl p-5 text-center">
                <p className="text-surface-900 font-semibold text-[15px] mb-2">{p.name}</p>
                <span className={`inline-block text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${p.color}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-surface-900 tracking-tight mb-4">
            Ready to get started?
          </h2>
          <p className="text-surface-500 text-[15px] mb-8 max-w-sm mx-auto">
            Join developers earning from AI wait time, or advertisers reaching them while they build.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/auth/signup" className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-7 py-3 rounded-xl text-[15px] transition-colors shadow-sm shadow-brand-500/20">
              Sign up free →
            </Link>
            <Link href="/comparison" className="text-surface-500 hover:text-surface-700 font-medium px-5 py-3 text-[15px] transition-colors">
              Compare tools
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
