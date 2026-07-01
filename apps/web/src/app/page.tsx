export default function HomePage() {
  return (
    <div className="min-h-screen bg-ink-900">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-ink-900/80 backdrop-blur-xl border-b border-ink-600/30">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="text-white font-semibold text-lg">WaitLayer</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="text-ink-300 hover:text-white text-sm transition-colors">How it works</a>
            <a href="#for-devs" className="text-ink-300 hover:text-white text-sm transition-colors">For developers</a>
            <a href="#for-advertisers" className="text-ink-300 hover:text-white text-sm transition-colors">For advertisers</a>
            <a href="/auth/login" className="text-ink-300 hover:text-white text-sm transition-colors">Login</a>
            <a href="/auth/signup" className="bg-brand-500 hover:bg-brand-600 text-white text-sm px-4 py-2 rounded-lg transition-colors">Get started</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-4 py-1.5 text-brand-500 text-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
            Privacy-first. Global payouts. Fraud-resistant.
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-6">
            Earn from AI
            <br />
            <span className="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">wait time.</span>
          </h1>
          <p className="text-xl text-ink-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            WaitLayer helps developers earn from opt-in sponsored messages shown during AI coding assistant wait states — with PayPal-first payouts, transparent earnings, and privacy-first integrations.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a href="/auth/signup" className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-8 py-3.5 rounded-xl text-lg transition-colors">
              Start earning
            </a>
            <a href="#how-it-works" className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-8 py-3.5 rounded-xl text-lg border border-ink-600/50 transition-colors">
              Learn more
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-6 bg-ink-800/30">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-bold text-white text-center mb-4">How it works</h2>
          <p className="text-ink-300 text-center mb-16 max-w-xl mx-auto">
            A simple marketplace loop — from wait state to payout.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {[
              { step: '01', title: 'Install extension', desc: 'Add the WaitLayer VS Code extension or terminal CLI' },
              { step: '02', title: 'See sponsored messages', desc: 'Opt-in ads appear during AI coding wait states' },
              { step: '03', title: 'Impression tracked', desc: 'Qualified impressions after 5-second minimum visible duration' },
              { step: '04', title: 'Advertiser charged', desc: 'Ledger-based accounting: 60% user, 30% platform, 10% reserve' },
              { step: '05', title: 'Get paid', desc: 'PayPal-first payouts with transparent earning states' },
            ].map((item) => (
              <div key={item.step} className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 relative">
                <span className="text-brand-500/20 text-6xl font-bold absolute top-2 right-4">{item.step}</span>
                <h3 className="text-white font-semibold mb-2 relative z-10">{item.title}</h3>
                <p className="text-ink-300 text-sm relative z-10">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For Developers */}
      <section id="for-devs" className="py-24 px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-bold text-white text-center mb-16">For developers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: 'Earn from waiting', desc: 'You already wait for AI responses. Now earn from that time with clearly labeled, opt-in sponsored messages.' },
              { title: 'PayPal-first payouts', desc: 'We start with PayPal because it works globally. Stripe, Payoneer, Wise, and Razorpay support comes next.' },
              { title: 'Transparent earnings', desc: 'Estimated, pending, confirmed, and held — every earning state is visible. No hidden balances.' },
              { title: 'Privacy-first', desc: 'We never read your code, prompts, completions, or file names. Privacy is enforced by schema, not just policy.' },
              { title: 'Full control', desc: 'Disable ads any time. Block categories. Set quiet mode. Choose your ad frequency. Your attention, your rules.' },
              { title: 'Trust scoring', desc: 'Transparent trust levels determine payout speed. Verify email + GitHub to earn faster.' },
            ].map((item) => (
              <div key={item.title} className="bg-ink-800/50 border border-ink-600/30 rounded-xl p-8">
                <h3 className="text-white font-semibold text-lg mb-3">{item.title}</h3>
                <p className="text-ink-300 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* For Advertisers */}
      <section id="for-advertisers" className="py-24 px-6 bg-ink-800/30">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-3xl font-bold text-white text-center mb-16">For advertisers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: 'Verified developer attention', desc: 'Reach developers while they are actively building — not scrolling.' },
              { title: 'Transparent performance', desc: 'Real CPM, CPC, CTR, and invalid traffic reporting. Know what you pay for.' },
              { title: 'Fraud protection', desc: 'Rate limits, trust scoring, minimum visible duration, and manual review before campaigns go live.' },
              { title: 'Country & tool targeting', desc: 'Target by country, tool type (VS Code, terminal, etc.), and developer category.' },
              { title: 'Self-serve campaigns', desc: 'Create and manage campaigns directly. Set budgets, frequency caps, and category filters.' },
              { title: 'Invalid traffic credits', desc: 'When fraud is detected, you get credits back. You only pay for valid impressions.' },
            ].map((item) => (
              <div key={item.title} className="bg-ink-800/50 border border-ink-600/30 rounded-xl p-8">
                <h3 className="text-white font-semibold text-lg mb-3">{item.title}</h3>
                <p className="text-ink-300 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to start?</h2>
          <p className="text-ink-300 mb-8">Join the waitlist or sign up to start earning from AI wait time.</p>
          <div className="flex items-center justify-center gap-4">
            <a href="/auth/signup" className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-8 py-3.5 rounded-xl text-lg transition-colors">
              Sign up free
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-ink-600/30">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center text-white font-bold text-xs">W</div>
            <span className="text-ink-400 text-sm">WaitLayer &copy; 2026</span>
          </div>
          <div className="flex gap-6 text-ink-400 text-sm">
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/advertiser-policy" className="hover:text-white transition-colors">Advertiser Policy</a>
            <a href="/payout-policy" className="hover:text-white transition-colors">Payout Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
