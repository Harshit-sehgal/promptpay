'use client';

import { useEffect, useMemo, useState } from 'react';
import { LoadingSpinner } from '@/components';
import {
  ActionLink,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Pill,
  Stat,
  type Tone,
} from '@/components/dash';
import { DeveloperGetStarted } from '@/components/developer-get-started';
import SandboxCreditPanel from '@/components/sandbox-credit-panel';
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
  chip?: boolean;
}

function trustConfig(level: string): { label: string; tone: Tone; width: string } {
  switch (level) {
    case 'high_trust':
      return { label: 'High trust', tone: 'ok', width: '90%' };
    case 'normal':
      return { label: 'Normal', tone: 'neutral', width: '60%' };
    case 'low_trust':
      return { label: 'Low trust', tone: 'warn', width: '30%' };
    case 'restricted':
    case 'banned':
      return { label: level.replace('_', ' '), tone: 'bad', width: '10%' };
    default:
      return { label: 'New', tone: 'neutral', width: '15%' };
  }
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

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const dashboardRes = await developerApi.getDashboard();
      setData(dashboardRes.data);
      try {
        const referralRes = await referralApi.getInfo();
        setReferral(referralRes.data);
      } catch {
        // Referral information is supplemental; it should not hide the core dashboard.
        setReferral(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const trust = data ? trustConfig(data.trustLevel) : trustConfig('new');

  const stats = useMemo<StatItem[]>(() => {
    if (!data) return [];

    return [
      {
        label: 'Available payout',
        value: moneyBreakdown(data.availableForPayoutByCurrency, data.availableForPayoutMinor),
        detail: 'Minimum payout applies per currency',
        chip: true,
      },
      {
        label: 'Estimated today',
        value: moneyBreakdown(data.estimatedEarningsByCurrency, data.estimatedEarnings),
        detail: 'Live earning estimate',
      },
      {
        label: 'Confirmed',
        value: moneyBreakdown(data.confirmedEarningsByCurrency, data.confirmedEarnings),
        detail: 'Ready after hold checks',
      },
      {
        label: 'Lifetime',
        value: moneyBreakdown(data.lifetimeEarningsByCurrency, data.lifetimeEarnings),
        detail: 'All credited earnings',
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
    <>
      <PageHeader
        eyebrow="Developer"
        title="Dashboard"
        lede="Earnings, payout readiness, trust status, and integration controls for your developer account."
        actions={
          <>
            <ActionLink href="/developer/settings">Settings</ActionLink>
            <ActionLink href="/developer/payouts" variant="primary">
              Payouts
            </ActionLink>
          </>
        }
      />

      {/* A-090: activation path. Self-hides once a client has connected, so it
          guides a new developer without becoming permanent furniture. */}
      <DeveloperGetStarted />

      {loading && (
        <div className="flex items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice
          tone="bad"
          role="alert"
          title="The dashboard could not load"
          actions={
            <>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="dash-btn dash-btn--glass dash-btn--sm"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="dash-btn dash-btn--ghost dash-btn--sm"
              >
                Dismiss
              </button>
            </>
          }
        >
          {error}
        </Notice>
      )}

      {data && (
        <>
          <SandboxCreditPanel />

          <Panel label="Account status">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={data.settings?.adsEnabled ? 'ok' : 'warn'}>
                  {data.settings?.adsEnabled ? 'Ads enabled' : 'Ads paused'}
                </Pill>
                <Pill tone={data.settings?.quietMode ? 'neutral' : 'ok'}>
                  {data.settings?.quietMode
                    ? `Quiet ${data.settings.quietModeStart || '22:00'}-${data.settings.quietModeEnd || '08:00'}`
                    : 'Quiet mode off'}
                </Pill>
                <Pill>{`${data.settings?.maxAdsPerHour ?? 6} ads/hour cap`}</Pill>
                <Pill tone={data.payoutHoldStatus.isHeld ? 'warn' : 'ok'}>
                  {data.payoutHoldStatus.isHeld ? 'Payout hold active' : 'Payout clear'}
                </Pill>
                {hasThresholdAmount(data.recoveryDebtByCurrency, data.recoveryDebtMinor, 1n) && (
                  <Pill tone="warn">
                    {`Recovery debt ${moneyBreakdown(data.recoveryDebtByCurrency, data.recoveryDebtMinor)}`}
                  </Pill>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {data.payoutHoldStatus.isHeld && (
                  <ActionLink href="/developer/trust">Improve trust</ActionLink>
                )}
                {hasThresholdAmount(
                  data.availableForPayoutByCurrency,
                  data.availableForPayoutMinor,
                  1000n,
                ) && (
                  <ActionLink href="/developer/payouts" variant="primary">
                    Request payout
                  </ActionLink>
                )}
              </div>
            </div>
          </Panel>

          <div className="dash-grid dash-grid--4">
            {stats.map(({ label, value, detail, chip }) => (
              <Panel key={label} label={label}>
                <Stat label={label} value={value} detail={detail} chip={chip} />
              </Panel>
            ))}
          </div>

          <div className="dash-grid dash-grid--wide-left">
            <Panel label="Earnings breakdown" flush>
              <PanelHeader
                title="Earnings Breakdown"
                action={
                  <ActionLink href="/developer/earnings" variant="text">
                    View history
                  </ActionLink>
                }
              />
              <div className="dash-rows">
                {[
                  {
                    label: 'Estimated',
                    value: moneyBreakdown(data.estimatedEarningsByCurrency, data.estimatedEarnings),
                    detail: 'Recorded but not confirmed',
                  },
                  {
                    label: 'Pending',
                    value: moneyBreakdown(data.pendingEarningsByCurrency, data.pendingEarnings),
                    detail: 'In review or hold window',
                  },
                  {
                    label: 'Confirmed',
                    value: moneyBreakdown(data.confirmedEarningsByCurrency, data.confirmedEarnings),
                    detail: 'Eligible for payout allocation',
                  },
                  {
                    label: 'Held',
                    value: moneyBreakdown(data.heldEarningsByCurrency, data.heldEarnings),
                    detail: 'Temporarily blocked for review',
                  },
                ].map((item) => (
                  <div key={item.label} className="grid grid-cols-[1fr_auto] items-center gap-4">
                    <div>
                      <p className="text-[15px] font-medium text-[var(--ink)]">{item.label}</p>
                      <p className="mt-0.5 text-[13px] text-[var(--muted)]">{item.detail}</p>
                    </div>
                    <p className="dash-mono text-lg text-[var(--ink)]">{item.value}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel label="Trust and payout status">
              <PanelHeader title="Trust & Payout Status" />
              <div className="flex items-center justify-between gap-3">
                <Pill tone={trust.tone}>
                  <span className="capitalize">{trust.label}</span>
                </Pill>
                <span className="dash-mono text-sm text-[var(--ink)]">{data.trustScore}/100</span>
              </div>
              <div
                className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--hair)]"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-[var(--ink)] transition-all duration-700 motion-reduce:transition-none"
                  style={{ width: trust.width }}
                />
              </div>
              <div className="mt-5">
                <Notice
                  tone={data.payoutHoldStatus.isHeld ? 'warn' : 'ok'}
                  title={data.payoutHoldStatus.isHeld ? 'Hold active' : 'Ready for payouts'}
                >
                  {data.payoutHoldStatus.reason ||
                    'No active payout hold. Confirmed earnings can be requested once the threshold is met.'}
                </Notice>
              </div>
              <div className="mt-5 grid gap-1">
                {[
                  { label: 'Trust details', href: '/developer/trust' },
                  { label: 'Extension settings', href: '/developer/settings' },
                  { label: 'Payout methods', href: '/developer/payouts' },
                ].map((item) => (
                  <ActionLink key={item.href} href={item.href} variant="text">
                    {item.label}
                  </ActionLink>
                ))}
              </div>
            </Panel>
          </div>

          {referral && (
            <Panel label="Referral program" flush>
              <PanelHeader
                title="Referral Program"
                action={
                  <ActionLink href="/developer/referral" variant="text">
                    View details
                  </ActionLink>
                }
              />
              <div className="grid gap-0 divide-y divide-[var(--hair)] md:grid-cols-3 md:divide-x md:divide-y-0">
                <div className="px-[22px] py-5">
                  <Stat label="Code" value={referral.referralCode || 'N/A'} />
                </div>
                <div className="px-[22px] py-5">
                  <Stat label="Referrals" value={referral.referralCount} />
                </div>
                <div className="px-[22px] py-5">
                  <Stat
                    label="Rewards"
                    value={moneyBreakdown(
                      referral.rewardsEarnedByCurrency,
                      BigInt(referral.rewardsEarnedMinor),
                    )}
                  />
                </div>
              </div>
              {referral.referralLink && (
                <div className="flex flex-col gap-3 border-t border-[var(--hair)] px-[22px] py-4 md:flex-row md:items-center">
                  <code className="min-w-0 flex-1 rounded-xl border border-[var(--hair)] bg-[var(--glass-strong)] px-3 py-2.5 text-sm text-[var(--ink)] break-all">
                    {referral.referralLink}
                  </code>
                  <button
                    type="button"
                    onClick={copyReferral}
                    className="dash-btn dash-btn--primary dash-btn--md"
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              )}
            </Panel>
          )}

          <Panel label="Reward schedule" flush>
            <PanelHeader title="Reward schedule" />
            <div className="px-[22px] pt-4">
              <Notice tone="warn">
                Rewards are disabled during the private beta. Nothing accrues yet.
              </Notice>
            </div>
            <div className="grid gap-0 divide-y divide-[var(--hair)] md:grid-cols-3 md:divide-x md:divide-y-0">
              {[
                {
                  label: 'Set independently',
                  detail:
                    "If rewards launch, the rate is 60% of the qualifying bid for a verified impression. Ateva owes that amount; it is not a claim on the advertiser's payment, which settles to Ateva in full.",
                },
                {
                  label: 'Paid separately',
                  detail:
                    'An advertiser payment settles in full to Ateva. Your compensation is a separate payment through an approved fiat payout provider.',
                },
                {
                  label: 'Verified first',
                  detail:
                    'Only activity that clears the session, visibility, duplicate, budget, and fraud checks can qualify.',
                },
              ].map((item) => (
                <div key={item.label} className="px-[22px] py-5">
                  <p className="text-[15px] font-semibold text-[var(--ink)]">{item.label}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--copy)]">{item.detail}</p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
