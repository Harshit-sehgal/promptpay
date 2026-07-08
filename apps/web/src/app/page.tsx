'use client';

import { useState } from 'react';
import Link from 'next/link';

/* ── Small inline SVG icons (no emoji) ── */
const IconDownload = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
);
const IconMessage = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const IconEye = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
);
const IconWallet = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
);
const IconCheck = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconShield = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IconDollar = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
);
const IconChart = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
);
const IconLock = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const IconSliders = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
);
const IconStar = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
);
const IconTarget = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
);
const IconGlobe = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);
const IconSettings = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
);
const IconRefresh = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
);

export default function HomePage() {
  const [calcMode, setCalcMode] = useState<'developer' | 'advertiser'>('developer');
  
  // Developer calculator states
  const [devQueries, setDevQueries] = useState<number>(200);
  const [devAdFrequency, setDevAdFrequency] = useState<number>(40);
  const [devCpm, setDevCpm] = useState<number>(35);

  // Advertiser calculator states
  const [advBudget, setAdvBudget] = useState<number>(500);
  const [advCpm, setAdvCpm] = useState<number>(35);
  const [advCtr, setAdvCtr] = useState<number>(1.5);

  // Developer calculations
  const devDailyImpressions = devQueries * (devAdFrequency / 100);
  const devMonthlyImpressions = devDailyImpressions * 20; // 20 working days
  const devMonthlySpend = (devMonthlyImpressions / 1000) * devCpm;
  const devMonthlyEarnings = devMonthlySpend * 0.60; // 60% split
  const devDailyEarnings = devMonthlyEarnings / 20;
  const devAnnualEarnings = devMonthlyEarnings * 12;

  // Advertiser calculations
  const advImpressions = Math.round((advBudget / advCpm) * 1000);
  const advClicks = Math.round(advImpressions * (advCtr / 100));
  const advCpc = advClicks > 0 ? advBudget / advClicks : 0;

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">How it works</a>
            <a href="#developers" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">Developers</a>
            <a href="#advertisers" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">Advertisers</a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="text-surface-600 hover:text-surface-900 text-[14px] font-medium transition-colors px-3 py-1.5"
            >
              Log in
            </Link>
            <Link
              href="/auth/signup"
              className="bg-surface-900 hover:bg-surface-700 text-white text-[14px] font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-36 pb-28 px-6 relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200/60 rounded-full px-3.5 py-1 text-brand-600 text-[13px] font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Privacy-first · Global payouts · Fraud-resistant
          </div>
          <h1 className="text-5xl md:text-[68px] font-bold text-surface-900 tracking-tight leading-[1.08] mb-7">
            Earn from AI
            <br />
            <span className="gradient-text">wait time.</span>
          </h1>
          <p className="text-lg md:text-xl text-surface-500 max-w-2xl mx-auto mb-12 leading-relaxed font-light">
            WaitLayer helps developers earn from opt-in sponsored messages shown during AI coding assistant wait states — with PayPal-first payouts, transparent earnings, and privacy-first integrations.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/auth/signup"
              className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-7 py-3 rounded-xl text-[15px] transition-colors shadow-sm shadow-brand-500/20"
            >
              Start earning →
            </Link>
            <Link
              href="#how-it-works"
              className="bg-surface-100 hover:bg-surface-200 text-surface-700 font-medium px-7 py-3 rounded-xl text-[15px] transition-colors border border-surface-200"
            >
              Learn more
            </Link>
          </div>
        </div>

        {/* Subtle decorative gradient */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-brand-100/30 via-brand-50/15 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />
      </section>

      {/* ── Integration band ── */}
      <section className="py-12 px-6 border-y border-surface-100 bg-surface-50/50">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-surface-400 text-[13px] font-medium uppercase tracking-wider mb-4">Built for the AI-native era</p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-surface-300">
            {['VS Code', 'Cursor', 'Windsurf', 'Cline', 'Claude Code', 'Terminal'].map((tool) => (
              <span key={tool} className="text-[15px] font-medium">{tool}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-32 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
              How it works
            </h2>
            <p className="text-surface-500 text-lg max-w-xl mx-auto">
              A simple marketplace loop — from wait state to payout.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { step: '01', title: 'Install extension', desc: 'Add the WaitLayer VS Code extension or terminal CLI', Icon: IconDownload },
              { step: '02', title: 'See sponsored messages', desc: 'Opt-in ads appear during AI coding wait states', Icon: IconMessage },
              { step: '03', title: 'Impression tracked', desc: 'Qualified after 5-second minimum visible duration', Icon: IconEye },
              { step: '04', title: 'Advertiser charged', desc: 'Ledger-based accounting: 60% user, 30% platform, 10% reserve', Icon: IconWallet },
              { step: '05', title: 'Get paid', desc: 'PayPal-first payouts with transparent earning states', Icon: IconCheck },
            ].map((item) => (
              <div
                key={item.step}
                className="card-hover bg-white border border-surface-200/80 rounded-2xl p-7 relative group"
              >
                <span className="text-brand-500/20 mb-4 block"><item.Icon /></span>
                <span className="text-brand-400/30 text-6xl font-bold absolute top-3 right-5 leading-none select-none">{item.step}</span>
                <h3 className="text-surface-900 font-semibold text-[15px] mb-2 relative z-10">{item.title}</h3>
                <p className="text-surface-500 text-[14px] leading-relaxed relative z-10">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Developers ── */}
      <section id="developers" className="py-32 px-6 bg-surface-50/60">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
              For developers
            </h2>
            <p className="text-surface-500 text-lg max-w-xl mx-auto">
              Your attention has value. Here's how you keep control.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { title: 'Earn from waiting', desc: 'You already wait for AI responses. Now earn from that time with clearly labeled, opt-in sponsored messages.', Icon: IconDollar },
              { title: 'PayPal-first payouts', desc: 'We start with PayPal because it works globally. Stripe, Payoneer, Wise, and Razorpay support comes next.', Icon: IconWallet },
              { title: 'Transparent earnings', desc: 'Estimated, pending, confirmed, and held — every earning state is visible. No hidden balances.', Icon: IconChart },
              { title: 'Privacy-first', desc: 'We never read your code, prompts, completions, or file names. Privacy is enforced by schema, not just policy.', Icon: IconLock },
              { title: 'Full control', desc: 'Disable ads any time. Block categories. Set quiet mode. Choose your ad frequency. Your attention, your rules.', Icon: IconSliders },
              { title: 'Trust scoring', desc: 'Transparent trust levels determine payout speed. Verify email + GitHub to earn faster.', Icon: IconStar },
            ].map((item) => (
              <div key={item.title} className="card-hover bg-white border border-surface-200/80 rounded-2xl p-8">
                <span className="text-brand-500/30 mb-4 block"><item.Icon /></span>
                <h3 className="text-surface-900 font-semibold text-[16px] mb-3">{item.title}</h3>
                <p className="text-surface-500 text-[14px] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Advertisers ── */}
      <section id="advertisers" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
              For advertisers
            </h2>
            <p className="text-surface-500 text-lg max-w-xl mx-auto">
              Reach developers while they're building — not scrolling.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { title: 'Verified developer attention', desc: 'Reach developers while they are actively building — not scrolling feeds or browsing passively.', Icon: IconTarget },
              { title: 'Transparent performance', desc: 'Real CPM, CPC, CTR, and invalid traffic reporting. Know what you pay for.', Icon: IconChart },
              { title: 'Fraud protection', desc: 'Rate limits, trust scoring, minimum visible duration, and manual review before campaigns go live.', Icon: IconShield },
              { title: 'Country & tool targeting', desc: 'Target by country, tool type (VS Code, terminal, etc.), and developer category.', Icon: IconGlobe },
              { title: 'Self-serve campaigns', desc: 'Create and manage campaigns directly. Set budgets, frequency caps, and category filters.', Icon: IconSettings },
              { title: 'Invalid traffic credits', desc: 'When fraud is detected, you get credits back. You only pay for valid impressions.', Icon: IconRefresh },
            ].map((item) => (
              <div key={item.title} className="card-hover bg-white border border-surface-200/80 rounded-2xl p-8">
                <span className="text-brand-500/30 mb-4 block"><item.Icon /></span>
                <h3 className="text-surface-900 font-semibold text-[16px] mb-3">{item.title}</h3>
                <p className="text-surface-500 text-[14px] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Interactive Calculator Section ── */}
      <section className="py-32 px-6 border-t border-surface-100 bg-white">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
              Estimate your <span className="gradient-text">WaitLayer impact</span>
            </h2>
            <p className="text-surface-500 text-lg max-w-xl mx-auto">
              Choose your role to calculate potential developer earnings or advertiser reach.
            </p>

            {/* Mode Toggle Switch */}
            <div className="flex justify-center mt-8">
              <div className="inline-flex rounded-full bg-surface-100 p-1 border border-surface-200/80">
                <button
                  type="button"
                  onClick={() => setCalcMode('developer')}
                  className={`px-6 py-2 rounded-full text-[14px] font-semibold transition-all duration-200 ${
                    calcMode === 'developer'
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                >
                  For Developers
                </button>
                <button
                  type="button"
                  onClick={() => setCalcMode('advertiser')}
                  className={`px-6 py-2 rounded-full text-[14px] font-semibold transition-all duration-200 ${
                    calcMode === 'advertiser'
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                >
                  For Advertisers
                </button>
              </div>
            </div>
          </div>

          <div className="bg-surface-50/60 border border-surface-200/80 rounded-3xl p-8 md:p-12 shadow-sm">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Left Column: Sliders */}
              <div className="space-y-8">
                {calcMode === 'developer' ? (
                  <>
                    <h3 className="text-lg font-bold text-surface-900">Your Developer Activity</h3>
                    
                    {/* Daily Queries */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Daily AI Queries</span>
                        <span className="font-semibold text-brand-600">{devQueries} queries</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="800"
                        step="50"
                        value={devQueries}
                        onChange={(e) => setDevQueries(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>50</span>
                        <span>400</span>
                        <span>800</span>
                      </div>
                    </div>

                    {/* Ad Frequency */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Ad Display Frequency</span>
                        <span className="font-semibold text-brand-600">{devAdFrequency}% of queries</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        step="10"
                        value={devAdFrequency}
                        onChange={(e) => setDevAdFrequency(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>10% (minimal)</span>
                        <span>50%</span>
                        <span>100% (every wait)</span>
                      </div>
                    </div>

                    {/* Estimated CPM */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Average Campaign CPM</span>
                        <span className="font-semibold text-brand-600">${devCpm}</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="120"
                        step="5"
                        value={devCpm}
                        onChange={(e) => setDevCpm(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>$10</span>
                        <span>$65</span>
                        <span>$120</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-surface-900">Your Campaign Settings</h3>

                    {/* Budget */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Campaign Budget</span>
                        <span className="font-semibold text-brand-600">${advBudget}</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="5000"
                        step="50"
                        value={advBudget}
                        onChange={(e) => setAdvBudget(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>$50</span>
                        <span>$2,500</span>
                        <span>$5,000</span>
                      </div>
                    </div>

                    {/* Target CPM */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Target CPM</span>
                        <span className="font-semibold text-brand-600">${advCpm}</span>
                      </div>
                      <input
                        type="range"
                        min="15"
                        max="120"
                        step="5"
                        value={advCpm}
                        onChange={(e) => setAdvCpm(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>$15</span>
                        <span>$65</span>
                        <span>$120</span>
                      </div>
                    </div>

                    {/* Estimated CTR */}
                    <div>
                      <div className="flex justify-between text-sm font-medium text-surface-700 mb-2">
                        <span>Expected Click-Through Rate (CTR)</span>
                        <span className="font-semibold text-brand-600">{advCtr}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="5"
                        step="0.1"
                        value={advCtr}
                        onChange={(e) => setAdvCtr(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-surface-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                      />
                      <div className="flex justify-between text-xs text-surface-400 mt-1">
                        <span>0.5%</span>
                        <span>2.5%</span>
                        <span>5.0%</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Right Column: Outcomes */}
              <div className="flex flex-col justify-between bg-white border border-surface-200 rounded-2xl p-8">
                {calcMode === 'developer' ? (
                  <>
                    <div>
                      <h4 className="text-surface-400 text-xs font-semibold uppercase tracking-wider mb-2">
                        Estimated Developer Revenue (60% split)
                      </h4>
                      <div className="text-5xl font-bold text-surface-900 tracking-tight mb-6">
                        ${devMonthlyEarnings.toFixed(2)}<span className="text-lg font-normal text-surface-500"> / month</span>
                      </div>
                      
                      <div className="space-y-4 border-t border-surface-100 pt-6">
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Estimated Daily Earnings</span>
                          <span className="font-semibold text-surface-900">${devDailyEarnings.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Estimated Annual Earnings</span>
                          <span className="font-semibold text-surface-900">${devAnnualEarnings.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Monthly Impressions</span>
                          <span className="font-semibold text-surface-900">{devMonthlyImpressions.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-surface-100">
                      <p className="text-xs text-surface-400 leading-relaxed">
                        *Estimates assume 20 active working days/month. High trust score status qualifies you for immediate payouts without hold periods.
                      </p>
                      <Link
                        href="/auth/signup"
                        className="mt-5 w-full inline-flex items-center justify-center bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3.5 px-4 rounded-xl text-[14px] transition-colors"
                      >
                        Create Developer Account
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h4 className="text-surface-400 text-xs font-semibold uppercase tracking-wider mb-2">
                        Estimated Campaign Reach
                      </h4>
                      <div className="text-5xl font-bold text-surface-900 tracking-tight mb-6">
                        {advImpressions.toLocaleString()}<span className="text-lg font-normal text-surface-500"> impressions</span>
                      </div>

                      <div className="space-y-4 border-t border-surface-100 pt-6">
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Estimated Clicks ({advCtr}%)</span>
                          <span className="font-semibold text-surface-900">{advClicks.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Effective Cost Per Click (CPC)</span>
                          <span className="font-semibold text-surface-900">${advCpc.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-surface-500">Audience</span>
                          <span className="font-semibold text-surface-900">Verified Active Developers</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-surface-100">
                      <p className="text-xs text-surface-400 leading-relaxed">
                        *All ad delivery uses rate limit controls and fingerprint verification to prevent click fraud. Platform commissions split directly to developers.
                      </p>
                      <Link
                        href="/auth/signup"
                        className="mt-5 w-full inline-flex items-center justify-center bg-surface-900 hover:bg-surface-800 text-white font-semibold py-3.5 px-4 rounded-xl text-[14px] transition-colors"
                      >
                        Start Advertiser Campaign
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Revenue split showcase ── */}
      <section className="py-32 px-6 bg-surface-50/60">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
            Transparent economics
          </h2>
          <p className="text-surface-500 text-lg max-w-xl mx-auto mb-16">
            Every dollar is accounted for. No hidden fees.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="card-hover bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <div className="text-5xl font-bold gradient-text mb-3">60%</div>
              <div className="text-surface-900 font-semibold text-[15px] mb-1">Developer earns</div>
              <p className="text-surface-500 text-[14px]">The majority goes to the person whose attention is being valued.</p>
            </div>
            <div className="card-hover bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <div className="text-5xl font-bold text-surface-900 mb-3">30%</div>
              <div className="text-surface-900 font-semibold text-[15px] mb-1">Platform</div>
              <p className="text-surface-500 text-[14px]">Infrastructure, fraud detection, payment processing, and support.</p>
            </div>
            <div className="card-hover bg-white border border-surface-200/80 rounded-2xl p-8 text-center">
              <div className="text-5xl font-bold text-surface-400 mb-3">10%</div>
              <div className="text-surface-900 font-semibold text-[15px] mb-1">Fraud & payment reserve</div>
              <p className="text-surface-500 text-[14px]">Reserve for disputed impressions, chargebacks, and payout failures.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-surface-900 tracking-tight mb-5">
            Ready to start?
          </h2>
          <p className="text-surface-500 text-lg mb-10 max-w-md mx-auto">
            Join developers who earn from AI wait time. Set up in under 2 minutes.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/auth/signup"
              className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-8 py-3.5 rounded-xl text-[15px] transition-colors shadow-sm shadow-brand-500/20"
            >
              Sign up free →
            </Link>
            <Link
              href="/auth/login"
              className="text-surface-500 hover:text-surface-700 font-medium px-6 py-3.5 text-[15px] transition-colors"
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-16 px-6 border-t border-surface-200/60">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row items-start justify-between gap-10">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-6 h-6 rounded bg-brand-500 flex items-center justify-center text-white font-bold text-[10px]">
                  W
                </div>
                <span className="text-surface-900 font-semibold text-[14px]">WaitLayer</span>
              </div>
              <p className="text-surface-400 text-[14px] max-w-xs leading-relaxed">
                Privacy-first reward marketplace for AI coding assistant wait states.
              </p>
            </div>
            <div className="flex gap-16">
              <div>
                <h4 className="text-surface-900 font-semibold text-[13px] mb-3">Product</h4>
                <div className="flex flex-col gap-2">
                  <Link href="/pricing" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Pricing</Link>
                  <Link href="/comparison" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">Comparison</Link>
                  <a href="#how-it-works" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">How it works</a>
                  <a href="#developers" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">For developers</a>
                  <a href="#advertisers" className="text-surface-500 hover:text-surface-700 text-[14px] transition-colors">For advertisers</a>
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
          <div className="mt-12 pt-6 border-t border-surface-100 text-surface-400 text-[13px]">
            © 2026 WaitLayer. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
