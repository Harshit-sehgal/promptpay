'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  DollarSign,
  Gift,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Star,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { developerApi, referralApi } from '@/lib/api/services';
import { formatCurrencyBreakdown } from '@/lib/format';

interface DashboardData {
  estimatedEarnings: bigint;
  confirmedEarnings: bigint;
  pendingEarnings: bigint;
  heldEarnings: bigint;
  reversedEarnings: bigint;
  recoveryDebtMinor: bigint;
  availableForPayoutMinor: bigint;
  lifetimeEarnings: bigint;
  estimatedEarningsByCurrency?: Record<string, bigint | number>;
  confirmedEarningsByCurrency?: Record<string, bigint | number>;
  pendingEarningsByCurrency?: Record<string, bigint | number>;
  heldEarningsByCurrency?: Record<string, bigint | number>;
  reversedEarningsByCurrency?: Record<string, bigint | number>;
  recoveryDebtByCurrency?: Record<string, bigint | number>;
  availableForPayoutByCurrency?: Record<string, bigint | number>;
  lifetimeEarningsByCurrency?: Record<string, bigint | number>;
  trustLevel: string;
  trustScore: number;
  payoutHoldStatus: {
    isHeld: boolean;
    reason?: string;
  };
  settings: {
    adsEnabled: boolean;
    quietMode: boolean;
    quietModeStart?: string | null;
    quietModeEnd?: string | null;
    maxAdsPerHour: number;
  };
}

interface ReferralSummary {
  referralCode: string | null;
  referralCount: number;
  referralLink: string | null;
  rewardsEarnedMinor: bigint;
  rewardsEarnedByCurrency?: Record<string, bigint | number>;
}

interface StatItem {
  label: string;
  value: string;
  detail: string;
  Icon: LucideIcon;
  valueClass?: string;
}

function trustConfig(level: string) {
  switch (level) {
    case 'high_trust':
      return {
        label: 'High trust',
        textClass: 'text-emerald-700',
        barClass: 'bg-emerald-500',
        width: '90%',
      };
    case 'normal':
      return {
        label: 'Normal',
        textClass: 'text-surface-900',
        barClass: 'bg-brand-500',
        width: '60%',
      };
    case 'low_trust':
      return {
        label: 'Low trust',
        textClass: 'text-amber-700',
        barClass: 'bg-amber-500',
        width: '30%',
      };
    case 'restricted':
    case 'banned':
      return {
        label: level.replace('_', ' '),
        textClass: 'text-rose-700',
        barClass: 'bg-rose-500',
        width: '10%',
      };
    default:
      return {
        label: 'New',
        textClass: 'text-surface-600',
        barClass: 'bg-surface-400',
        width: '15%',
      };
  }
}

function StatusPill({ label, tone }: { label: string; tone: 'success' | 'warning' | 'neutral' }) {
  const toneClass = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
    warning: 'bg-amber-50 text-amber-700 border-amber-200/70',
    neutral: 'bg-surface-50 text-surface-600 border-surface-200',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {label}
    </span>
  );
}

function moneyBreakdown(
  byCurrency: Record<string, bigint | number> | undefined,
  legacyUsd: bigint,
): string {
  return formatCurrencyBreakdown(byCurrency ?? { USD: legacyUsd });
}

function hasThresholdAmount(
  byCurrency: Record<string, bigint | number> | undefined,
  legacyUsd: bigint,
  thresholdMinor: bigint,
): boolean {
  return Object.values(byCurrency ?? { USD: legacyUsd }).some(
    (amountMinor) => BigInt(amountMinor) >= thresholdMinor,
  );
}

export default function DeveloperDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([developerApi.getDashboard(), referralApi.getInfo()])
      .then(([dashboardRes, referralRes]) => {
        setData(dashboardRes.data);
        setReferral(referralRes.data);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load dashboard')))
      .finally(() => setLoading(false));
  }, []);

  const trust = data ? trustConfig(data.trustLevel) : trustConfig('new');

  const stats = useMemo<StatItem[]>(() => {
    if (!data) return [];

    return [
      {
        label: 'Estimated today',
        value: moneyBreakdown(data.estimatedEarningsByCurrency, data.estimatedEarnings),
        detail: 'Live earning estimate',
        Icon: TrendingUp,
      },
      {
        label: 'Available payout',
        value: moneyBreakdown(data.availableForPayoutByCurrency, data.availableForPayoutMinor),
        detail: 'Minimum payout applies per currency',
        Icon: Wallet,
        valueClass: hasThresholdAmount(
          data.availableForPayoutByCurrency,
          data.availableForPayoutMinor,
          1000n,
        )
          ? 'text-emerald-600'
          : undefined,
      },
      {
        label: 'Confirmed',
        value: moneyBreakdown(data.confirmedEarningsByCurrency, data.confirmedEarnings),
        detail: 'Ready after hold checks',
        Icon: CheckCircle2,
        valueClass: 'text-surface-900',
      },
      {
        label: 'Lifetime',
        value: moneyBreakdown(data.lifetimeEarningsByCurrency, data.lifetimeEarnings),
        detail: 'All credited earnings',
        Icon: Star,
      },
    ];
  }, [data]);

  const copyReferral = () => {
    if (!referral?.referralLink) return;

    navigator.clipboard.writeText(referral.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-600">
            Developer
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-surface-950">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-surface-500">
            Earnings, payout readiness, trust status, and integration controls for your developer
            account.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/developer/settings"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-surface-200 bg-white px-3.5 text-sm font-medium text-surface-700 shadow-sm transition-colors hover:bg-surface-50"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <Link
            href="/developer/payouts"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-surface-950 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-surface-800"
          >
            <Wallet className="h-4 w-4" />
            Payouts
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="mb-8 flex items-center justify-between rounded-lg border border-red-200/70 bg-red-50 p-4">
          <p className="text-sm font-normal text-red-600">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs font-medium text-red-500 transition-colors hover:text-red-700"
          >
            Dismiss
          </button>
        </div>
      )}

      {data && (
        <>
          <section className="mb-6 rounded-lg border border-surface-200/80 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill
                  label={data.settings?.adsEnabled ? 'Ads enabled' : 'Ads paused'}
                  tone={data.settings?.adsEnabled ? 'success' : 'warning'}
                />
                <StatusPill
                  label={
                    data.settings?.quietMode
                      ? `Quiet ${data.settings.quietModeStart || '22:00'}-${data.settings.quietModeEnd || '08:00'}`
                      : 'Quiet mode off'
                  }
                  tone={data.settings?.quietMode ? 'neutral' : 'success'}
                />
                <StatusPill
                  label={`${data.settings?.maxAdsPerHour ?? 6} ads/hour cap`}
                  tone="neutral"
                />
                <StatusPill
                  label={data.payoutHoldStatus.isHeld ? 'Payout hold active' : 'Payout clear'}
                  tone={data.payoutHoldStatus.isHeld ? 'warning' : 'success'}
                />
                {hasThresholdAmount(data.recoveryDebtByCurrency, data.recoveryDebtMinor, 1n) && (
                  <StatusPill
                    label={`Recovery debt ${moneyBreakdown(data.recoveryDebtByCurrency, data.recoveryDebtMinor)}`}
                    tone="warning"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.payoutHoldStatus.isHeld && (
                  <Link
                    href="/developer/trust"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Improve trust
                  </Link>
                )}
                {hasThresholdAmount(
                  data.availableForPayoutByCurrency,
                  data.availableForPayoutMinor,
                  1000n,
                ) && (
                  <Link
                    href="/developer/payouts"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                  >
                    Request payout
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          </section>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, detail, Icon, valueClass }) => (
              <section
                key={label}
                aria-label={label}
                className="rounded-lg border border-surface-200/80 bg-white p-5 shadow-sm"
              >
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                    {label}
                  </p>
                  <Icon className="h-5 w-5 text-surface-400" />
                </div>
                <p
                  className={`font-mono text-3xl font-semibold tracking-tight ${valueClass || 'text-surface-950'}`}
                >
                  {value}
                </p>
                <p className="mt-2 text-xs text-surface-500">{detail}</p>
              </section>
            ))}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <section
              aria-label="Earnings breakdown"
              className="rounded-lg border border-surface-200/80 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-surface-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-950">
                  <DollarSign className="h-4 w-4 text-surface-400" />
                  Earnings Breakdown
                </h2>
                <Link
                  href="/developer/earnings"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
                >
                  View history
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="divide-y divide-surface-100">
                {[
                  {
                    label: 'Estimated',
                    value: moneyBreakdown(data.estimatedEarningsByCurrency, data.estimatedEarnings),
                    Icon: TrendingUp,
                    detail: 'Recorded but not confirmed',
                  },
                  {
                    label: 'Pending',
                    value: moneyBreakdown(data.pendingEarningsByCurrency, data.pendingEarnings),
                    Icon: Clock3,
                    detail: 'In review or hold window',
                  },
                  {
                    label: 'Confirmed',
                    value: moneyBreakdown(data.confirmedEarningsByCurrency, data.confirmedEarnings),
                    Icon: CheckCircle2,
                    detail: 'Eligible for payout allocation',
                  },
                  {
                    label: 'Held',
                    value: moneyBreakdown(data.heldEarningsByCurrency, data.heldEarnings),
                    Icon: LockKeyhole,
                    detail: 'Temporarily blocked for review',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <item.Icon className="mt-0.5 h-4 w-4 text-surface-400" />
                      <div>
                        <p className="text-sm font-medium text-surface-900">{item.label}</p>
                        <p className="mt-0.5 text-xs text-surface-500">{item.detail}</p>
                      </div>
                    </div>
                    <p className="font-mono text-lg font-semibold text-surface-950">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section
              aria-label="Trust and payout status"
              className="rounded-lg border border-surface-200/80 bg-white shadow-sm"
            >
              <div className="border-b border-surface-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-950">
                  <ShieldCheck className="h-4 w-4 text-surface-400" />
                  Trust & Payout Status
                </h2>
              </div>
              <div className="p-5">
                <p
                  className={`text-2xl font-semibold capitalize tracking-tight ${trust.textClass}`}
                >
                  {trust.label}
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-100">
                    <div
                      className={`h-full rounded-full ${trust.barClass} transition-all duration-700`}
                      style={{ width: trust.width }}
                    />
                  </div>
                  <span className="font-mono text-sm font-semibold text-surface-700">
                    {data.trustScore}/100
                  </span>
                </div>
                <div
                  className={`mt-5 rounded-lg border p-4 ${data.payoutHoldStatus.isHeld ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}
                >
                  <p
                    className={`text-sm font-semibold ${data.payoutHoldStatus.isHeld ? 'text-amber-800' : 'text-emerald-800'}`}
                  >
                    {data.payoutHoldStatus.isHeld ? 'Hold active' : 'Ready for payouts'}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-surface-600">
                    {data.payoutHoldStatus.reason ||
                      'No active payout hold. Confirmed earnings can be requested once the threshold is met.'}
                  </p>
                </div>
                <div className="mt-5 grid gap-2">
                  {[
                    { label: 'Trust details', href: '/developer/trust', Icon: ShieldCheck },
                    { label: 'Extension settings', href: '/developer/settings', Icon: Settings },
                    { label: 'Payout methods', href: '/developer/payouts', Icon: Wallet },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center justify-between rounded-lg border border-surface-200 px-3 py-2.5 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-50 hover:text-surface-950"
                    >
                      <span className="flex items-center gap-2">
                        <item.Icon className="h-4 w-4 text-surface-400" />
                        {item.label}
                      </span>
                      <ArrowRight className="h-4 w-4 text-surface-400" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {referral && (
            <section className="mb-6 rounded-lg border border-surface-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-950">
                  <Gift className="h-4 w-4 text-surface-400" />
                  Referral Program
                </h2>
                <Link
                  href="/developer/referral"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
                >
                  View details
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid gap-0 divide-y divide-surface-100 md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                    Code
                  </p>
                  <p className="mt-2 font-mono text-xl font-semibold tracking-widest text-surface-950">
                    {referral.referralCode || 'N/A'}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                    Referrals
                  </p>
                  <p className="mt-2 text-xl font-semibold text-surface-950">
                    {referral.referralCount}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                    Rewards
                  </p>
                  <p className="mt-2 font-mono text-xl font-semibold text-emerald-600">
                    {moneyBreakdown(
                      referral.rewardsEarnedByCurrency,
                      BigInt(referral.rewardsEarnedMinor),
                    )}
                  </p>
                </div>
              </div>
              {referral.referralLink && (
                <div className="border-t border-surface-100 px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <code className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2.5 font-mono text-sm text-surface-700 break-all">
                      {referral.referralLink}
                    </code>
                    <button
                      onClick={copyReferral}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
                    >
                      <Copy className="h-4 w-4" />
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="rounded-lg border border-surface-200/80 bg-white shadow-sm">
            <div className="border-b border-surface-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-950">
                <Zap className="h-4 w-4 text-surface-400" />
                Revenue Split
              </h2>
            </div>
            <div className="grid gap-0 divide-y divide-surface-100 md:grid-cols-3 md:divide-x md:divide-y-0">
              {[
                {
                  pct: '60%',
                  label: 'Developer',
                  detail: 'Paid to you for qualified attention.',
                  tone: 'text-brand-700',
                },
                {
                  pct: '30%',
                  label: 'Platform',
                  detail: 'Infrastructure, review, and payments.',
                  tone: 'text-surface-950',
                },
                {
                  pct: '10%',
                  label: 'Reserve',
                  detail: 'Fraud, disputes, and payout failure buffer.',
                  tone: 'text-surface-500',
                },
              ].map((item) => (
                <div key={item.label} className="px-5 py-5">
                  <p className={`text-3xl font-semibold tracking-tight ${item.tone}`}>{item.pct}</p>
                  <p className="mt-2 text-sm font-semibold text-surface-950">{item.label}</p>
                  <p className="mt-1 text-sm leading-6 text-surface-500">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
