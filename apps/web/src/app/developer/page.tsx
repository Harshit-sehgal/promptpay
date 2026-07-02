'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { developerApi, referralApi } from '@/lib/api/services';
import { LoadingSpinner } from '@/components';
import { formatCurrency } from '@/lib/format';

/* ── Small inline SVG icons ── */
const IconTrendingUp = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
);
const IconWallet = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
);
const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const IconDollar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
);
const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);
const IconCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);
const IconLock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const IconStar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
);
const IconGift = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
);
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
);
const IconArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);

interface DashboardData {
  estimatedEarnings: number;
  confirmedEarnings: number;
  pendingEarnings: number;
  heldEarnings: number;
  availableForPayout: number;
  lifetimeEarnings: number;
  trustLevel: string;
  trustScore: number;
  payoutHoldStatus: {
    isHeld: boolean;
    reason?: string;
  };
  settings: {
    adsEnabled: boolean;
    quietMode: boolean;
    maxAdsPerHour: number;
  };
}

interface ReferralSummary {
  referralCode: string | null;
  referralCount: number;
  referralLink: string | null;
  rewardsEarnedMinor: number;
}

export default function DeveloperDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      developerApi.getDashboard(),
      referralApi.getInfo(),
    ])
      .then(([dashboardRes, referralRes]) => {
        setData(dashboardRes.data);
        setReferral(referralRes.data);
      })
      .catch((err) => setError(err.response?.data?.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  const copyReferral = () => {
    if (referral?.referralLink) {
      navigator.clipboard.writeText(referral.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const trustConfig = (level: string) => {
    switch (level) {
      case 'high_trust': return { text: 'High Trust', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', barColor: 'bg-emerald-400', barWidth: '90%' };
      case 'normal': return { text: 'Normal', color: 'text-sky-400', bg: 'bg-sky-400/10', border: 'border-sky-400/20', barColor: 'bg-sky-400', barWidth: '60%' };
      case 'low_trust': return { text: 'Low Trust', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', barColor: 'bg-amber-400', barWidth: '30%' };
      default: return { text: 'New', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', barColor: 'bg-amber-400', barWidth: '15%' };
    }
  };

  const trust = data ? trustConfig(data.trustLevel) : trustConfig('new');

  return (
    <div className="max-w-6xl mx-auto">
      {/* ── Hero header ── */}
      <div className="relative mb-10">
        <div className="absolute -top-20 -left-20 w-[400px] h-[300px] bg-gradient-to-br from-brand-500/8 via-brand-600/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-3.5 py-1 text-brand-400 text-[13px] font-medium mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Developer dashboard
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">
            Your <span className="gradient-text">earnings</span> overview
          </h1>
          <p className="text-ink-300 text-[15px] max-w-lg">
            Track your impressions, monitor payouts, and manage your developer account — all in one place.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-4 mb-8 flex items-center justify-between">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-red-300/60 hover:text-red-300 text-xs transition-colors">Dismiss</button>
        </div>
      )}

      {data && (
        <>
          {/* ── Primary stat cards ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
            {/* Estimated earnings */}
            <div className="group card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-brand-500/5 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex items-center gap-2 mb-4">
                <span className="text-brand-400/60"><IconTrendingUp /></span>
                <span className="text-ink-400 text-xs font-medium uppercase tracking-wider">Estimated today</span>
              </div>
              <p className="text-4xl font-bold text-white font-mono tracking-tight mb-1">{formatCurrency(data.estimatedEarnings)}</p>
              <p className="text-ink-400 text-[13px] flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                Updated in real time
              </p>
            </div>

            {/* Available for payout */}
            <div className="group card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-emerald-500/5 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex items-center gap-2 mb-4">
                <span className="text-emerald-400/60"><IconWallet /></span>
                <span className="text-ink-400 text-xs font-medium uppercase tracking-wider">Available for payout</span>
              </div>
              <p className="text-4xl font-bold text-emerald-400 font-mono tracking-tight mb-1">{formatCurrency(data.availableForPayout)}</p>
              <div className="flex items-center gap-3">
                <p className="text-ink-400 text-[13px]">Min: $10.00</p>
                {data.availableForPayout >= 1000 && (
                  <Link href="/developer/payouts" className="text-brand-400 hover:text-brand-300 text-[13px] font-medium flex items-center gap-1 transition-colors">
                    Request payout <IconArrowRight />
                  </Link>
                )}
              </div>
            </div>

            {/* Trust level */}
            <div className="group card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-sky-500/5 to-transparent rounded-bl-full pointer-events-none" />
              <div className="flex items-center gap-2 mb-4">
                <span className={`${trust.color} opacity-60`}><IconShield /></span>
                <span className="text-ink-400 text-xs font-medium uppercase tracking-wider">Trust level</span>
              </div>
              <p className={`text-4xl font-bold ${trust.color} tracking-tight mb-2`}>{trust.text}</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-ink-700 rounded-full overflow-hidden">
                  <div className={`h-full ${trust.barColor} rounded-full transition-all duration-1000 ease-out`} style={{ width: trust.barWidth }} />
                </div>
                <span className="text-ink-400 text-[13px] font-mono">{data.trustScore}/100</span>
              </div>
            </div>
          </div>

          {/* ── Earnings breakdown ── */}
          <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-semibold text-[15px] flex items-center gap-2">
                <span className="text-brand-400/50"><IconDollar /></span>
                Earnings breakdown
              </h2>
              <Link href="/developer/earnings" className="text-brand-400 hover:text-brand-300 text-[13px] font-medium flex items-center gap-1 transition-colors">
                View history <IconArrowRight />
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
              {[
                { label: 'Estimated', value: data.estimatedEarnings, Icon: IconTrendingUp, accent: 'text-brand-400/40' },
                { label: 'Pending', value: data.pendingEarnings, Icon: IconClock, accent: 'text-amber-400/40' },
                { label: 'Confirmed', value: data.confirmedEarnings, Icon: IconCheck, accent: 'text-emerald-400/40' },
                { label: 'Held', value: data.heldEarnings, Icon: IconLock, accent: 'text-red-400/40' },
                { label: 'Lifetime', value: data.lifetimeEarnings, Icon: IconStar, accent: 'text-brand-400/40' },
              ].map((item) => (
                <div key={item.label} className="bg-ink-700/30 border border-ink-600/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className={item.accent}><item.Icon /></span>
                    <p className="text-ink-400 text-xs font-medium uppercase tracking-wider">{item.label}</p>
                  </div>
                  <p className="text-white font-mono text-xl font-semibold">{formatCurrency(item.value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Two-column: Payout status + Quick actions ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
            {/* Payout hold status */}
            <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7">
              <h2 className="text-white font-semibold text-[15px] mb-5 flex items-center gap-2">
                <span className="text-brand-400/50"><IconWallet /></span>
                Payout status
              </h2>
              {data.payoutHoldStatus.isHeld ? (
                <div className={`${trust.bg} border ${trust.border} rounded-xl p-5`}>
                  <div className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-amber-400 text-sm font-medium mb-1">Payout hold active</p>
                      <p className="text-ink-300 text-[13px] leading-relaxed">
                        {data.payoutHoldStatus.reason || 'New accounts have a 30-day payout hold. Verify your email and GitHub to speed this up.'}
                      </p>
                      <Link href="/developer/trust" className="text-brand-400 hover:text-brand-300 text-[13px] font-medium mt-3 inline-flex items-center gap-1 transition-colors">
                        Improve trust score <IconArrowRight />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-400/8 border border-emerald-400/15 rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-emerald-400 text-sm font-medium mb-1">All clear</p>
                      <p className="text-ink-300 text-[13px] leading-relaxed">
                        Your account is in good standing — no payout hold active. Earnings are confirmed within 72 hours.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7">
              <h2 className="text-white font-semibold text-[15px] mb-5">Quick actions</h2>
              <div className="space-y-2.5">
                {[
                  { label: 'View earnings history', href: '/developer/earnings', Icon: IconDollar },
                  { label: 'Request a payout', href: '/developer/payouts', Icon: IconWallet },
                  { label: 'Trust & verification', href: '/developer/trust', Icon: IconShield },
                  { label: 'Extension settings', href: '/developer/settings', Icon: IconStar },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center justify-between bg-ink-700/30 hover:bg-ink-700/60 border border-ink-600/10 rounded-xl px-4 py-3 text-sm transition-all group"
                  >
                    <span className="flex items-center gap-3 text-ink-200 group-hover:text-white transition-colors">
                      <span className="text-brand-400/40 group-hover:text-brand-400/70 transition-colors"><item.Icon /></span>
                      {item.label}
                    </span>
                    <span className="text-ink-400 group-hover:text-ink-200 transition-colors"><IconArrowRight /></span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Referral card ── */}
          {referral && (
            <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-7 relative overflow-hidden">
              <div className="absolute bottom-0 right-0 w-64 h-48 bg-gradient-to-tl from-brand-500/5 to-transparent rounded-tl-full pointer-events-none" />
              <div className="relative">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-white font-semibold text-[15px] flex items-center gap-2">
                    <span className="text-brand-400/50"><IconGift /></span>
                    Referral program
                  </h2>
                  <Link href="/developer/referral" className="text-brand-400 hover:text-brand-300 text-[13px] font-medium flex items-center gap-1 transition-colors">
                    View details <IconArrowRight />
                  </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
                  <div className="bg-ink-700/30 border border-ink-600/10 rounded-xl p-4">
                    <p className="text-ink-400 text-xs font-medium uppercase tracking-wider mb-1.5">Your code</p>
                    <p className="text-white font-mono text-xl font-semibold tracking-widest">{referral.referralCode || 'N/A'}</p>
                  </div>
                  <div className="bg-ink-700/30 border border-ink-600/10 rounded-xl p-4">
                    <p className="text-ink-400 text-xs font-medium uppercase tracking-wider mb-1.5">Total referrals</p>
                    <p className="text-white font-mono text-xl font-semibold">{referral.referralCount}</p>
                  </div>
                  <div className="bg-ink-700/30 border border-ink-600/10 rounded-xl p-4">
                    <p className="text-ink-400 text-xs font-medium uppercase tracking-wider mb-1.5">Rewards earned</p>
                    <p className="text-emerald-400 font-mono text-xl font-semibold">{formatCurrency(referral.rewardsEarnedMinor)}</p>
                  </div>
                </div>

                {referral.referralLink && (
                  <div className="bg-ink-700/30 border border-ink-600/10 rounded-xl p-4">
                    <p className="text-ink-400 text-xs font-medium uppercase tracking-wider mb-2">Referral link</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-ink-900/50 border border-ink-600/20 rounded-lg px-4 py-2.5 text-ink-200 text-sm break-all font-mono">
                        {referral.referralLink}
                      </code>
                      <button
                        onClick={copyReferral}
                        className="bg-brand-500/15 hover:bg-brand-500/25 border border-brand-500/20 text-brand-400 px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 shrink-0"
                      >
                        <IconCopy />
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-ink-400 text-[13px] mt-2.5">
                      Share this link — earn <span className="text-emerald-400 font-medium">$5</span> per referral when they receive their first payout.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Revenue split showcase (matching landing page) ── */}
          <div className="mt-10 mb-4">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold text-white tracking-tight mb-2">How your earnings work</h2>
              <p className="text-ink-400 text-[14px]">Every impression is split transparently. No hidden fees.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-6 text-center">
                <div className="text-4xl font-bold gradient-text mb-2">60%</div>
                <div className="text-white font-semibold text-[14px] mb-1">You earn</div>
                <p className="text-ink-400 text-[13px] leading-relaxed">The majority goes directly to you for your attention.</p>
              </div>
              <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-6 text-center">
                <div className="text-4xl font-bold text-white mb-2">30%</div>
                <div className="text-white font-semibold text-[14px] mb-1">Platform</div>
                <p className="text-ink-400 text-[13px] leading-relaxed">Infrastructure, fraud detection, and payment processing.</p>
              </div>
              <div className="card-hover bg-ink-800/80 border border-ink-600/20 rounded-2xl p-6 text-center">
                <div className="text-4xl font-bold text-ink-300 mb-2">10%</div>
                <div className="text-white font-semibold text-[14px] mb-1">Reserve</div>
                <p className="text-ink-400 text-[13px] leading-relaxed">Fraud disputes, chargebacks, and payout failure buffer.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
