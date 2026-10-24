'use client';

import { useCallback, useMemo, useState } from 'react';
import { useEffect } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { bigintRatioPercent, formatCurrency, formatNumber, formatPercent } from '@/lib/format';

import { CURRENCY_POLICY } from '@ateva/shared';

// ── Types ──

interface DailyPoint {
  date: string;
  impressions: number;
  billableImpressions: number;
  signups: number;
  developerSignups: number;
  advertiserSignups: number;
  estimatedRevenueMinor: bigint;
  confirmedRevenueMinor: bigint;
  paidRevenueMinor: bigint;
  advertiserSpendMinor: bigint;
}

interface MetricsData {
  currency?: string;
  period: { days: number; from: string; to: string };
  daily: DailyPoint[];
  totals: {
    impressions: number;
    billableImpressions: number;
    signups: number;
    estimatedRevenueMinor: bigint;
    confirmedRevenueMinor: bigint;
    paidRevenueMinor: bigint;
    advertiserSpendMinor: bigint;
  };
  vsPreviousPeriod: {
    impressionsChangePct: number | null;
    signupsChangePct: number | null;
    revenueChangePct: number | null;
  };
  activeUsers: { developers: number; advertisers: number; admins: number; total: number };
  campaigns: { byStatus: { status: string; count: number }[]; total: number };
  payouts: { total: number; pending: number; totalPaidMinor: bigint };
  platformRevenue: { platformFeeMinor: bigint; fraudReserveMinor: bigint; totalMinor: bigint };
}

// ── Date helpers ──

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PERIOD_PRESETS = [
  { key: '7d' as const, label: '7 days', days: 7 },
  { key: '30d' as const, label: '30 days', days: 30 },
  { key: '90d' as const, label: '90 days', days: 90 },
];

// ── Mini bar chart (reused pattern from advertiser reports) ──

function MiniBar({
  values,
  maxValue,
}: {
  values: Array<bigint | number>;
  maxValue: bigint | number;
}) {
  const max = BigInt(maxValue) > 0n ? BigInt(maxValue) : 1n;
  return (
    <div className="flex items-end gap-[2px] h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className={`w-[6px] rounded-t-sm bg-[var(--ink)] transition-all duration-200`}
          style={{
            height: `${Math.min(100, bigintRatioPercent(v, max, 2))}%`,
            minHeight: BigInt(v) > 0n ? '2px' : '0',
          }}
        />
      ))}
    </div>
  );
}

// ── Component ──

export default function AdminMetricsPage() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(30);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');

  const fetchMetrics = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getMetrics(selectedDays, selectedCurrency)
      .then((res: { data: MetricsData }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load metrics')))
      .finally(() => setLoading(false));
  }, [selectedDays, selectedCurrency]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Max values for chart scaling
  const maxImpressions = useMemo(
    () => Math.max(...(data?.daily.map((d) => d.impressions) ?? [1]), 1),
    [data],
  );
  const maxSignups = useMemo(
    () => Math.max(...(data?.daily.map((d) => d.signups) ?? [1]), 1),
    [data],
  );
  const maxRevenue = useMemo(
    () =>
      data?.daily.reduce(
        (maximum, point) =>
          point.estimatedRevenueMinor > maximum ? point.estimatedRevenueMinor : maximum,
        1n,
      ) ?? 1n,
    [data],
  );
  const maxSpend = useMemo(
    () =>
      data?.daily.reduce(
        (maximum, point) =>
          point.advertiserSpendMinor > maximum ? point.advertiserSpendMinor : maximum,
        1n,
      ) ?? 1n,
    [data],
  );

  // Campaign status totals for distribution bar
  const campaignTotal = data?.campaigns.total ?? 1;
  const reportingCurrency = data?.currency ?? 'USD';

  // Status shades are ink at different strengths: the counts carry the meaning.
  const statusShade = (status: string): string =>
    status === 'active'
      ? 'opacity-100'
      : status === 'submitted'
        ? 'opacity-70'
        : status === 'paused'
          ? 'opacity-50'
          : status === 'draft'
            ? 'opacity-35'
            : 'opacity-20';

  const chartPanels = data
    ? [
        {
          title: 'Daily impressions',
          total: `${formatNumber(data.totals.impressions)} total`,
          values: data.daily.map((d) => d.impressions),
          max: maxImpressions,
        },
        {
          title: 'Daily signups',
          total: `${formatNumber(data.totals.signups)} total`,
          values: data.daily.map((d) => d.signups),
          max: maxSignups,
        },
        {
          title: 'Daily earnings (estimated)',
          total: formatCurrency(data.totals.estimatedRevenueMinor, reportingCurrency),
          values: data.daily.map((d) => d.estimatedRevenueMinor),
          max: maxRevenue,
        },
        {
          title: 'Daily advertiser spend',
          total: formatCurrency(data.totals.advertiserSpendMinor, reportingCurrency),
          values: data.daily.map((d) => d.advertiserSpendMinor),
          max: maxSpend,
        },
      ]
    : [];

  return (
    <>
      <PageHeader title="Operational metrics" />

      {/* Period and currency selectors */}
      <div className="dash-bar flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-[var(--muted)]">Period:</span>
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedDays(p.days)}
              className={`dash-btn dash-btn--sm ${
                selectedDays === p.days ? 'dash-btn--primary' : 'dash-btn--secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="ml-2 text-xs text-[var(--muted)]">
            {data
              ? `${formatDateShort(data.period.from)} – ${formatDateShort(data.period.to)}`
              : ''}
          </span>
        </div>

        {/* Currency selector — the platform is multi-currency (A-081);
            metrics were previously hard-filtered to USD. Selecting a
            currency re-queries that currency's revenue/spend. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-[var(--muted)]">Currency:</span>
          <select
            value={selectedCurrency}
            onChange={(e) => setSelectedCurrency(e.target.value)}
            className="px-3 py-1.5 text-xs"
          >
            {Object.keys(CURRENCY_POLICY).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading & error */}
      {loading && <LoadingSpinner />}
      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button onClick={fetchMetrics} className="dash-btn dash-btn--secondary dash-btn--sm">
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}

      {data && (
        <>
          {/* ── Summary stats ── */}
          <div className="dash-grid dash-grid--4">
            <Panel label="Impressions">
              <Stat
                label="Impressions"
                value={formatNumber(data.totals.impressions)}
                detail={
                  data.vsPreviousPeriod.impressionsChangePct !== null
                    ? `${data.vsPreviousPeriod.impressionsChangePct > 0 ? '↑' : '↓'} ${Math.abs(data.vsPreviousPeriod.impressionsChangePct).toFixed(1)}% vs prior period`
                    : undefined
                }
              />
            </Panel>
            <Panel label="Billable %">
              <Stat
                label="Billable %"
                value={
                  data.totals.impressions > 0
                    ? formatPercent(
                        (data.totals.billableImpressions / data.totals.impressions) * 100,
                      )
                    : '—'
                }
              />
            </Panel>
            <Panel label="Signups">
              <Stat
                label="Signups"
                value={formatNumber(data.totals.signups)}
                detail={
                  data.vsPreviousPeriod.signupsChangePct !== null
                    ? `${data.vsPreviousPeriod.signupsChangePct > 0 ? '↑' : '↓'} ${Math.abs(data.vsPreviousPeriod.signupsChangePct).toFixed(1)}% vs prior period`
                    : undefined
                }
              />
            </Panel>
            <Panel label="Active users">
              <Stat label="Active users" value={formatNumber(data.activeUsers.total)} />
            </Panel>
          </div>

          <div className="dash-grid dash-grid--4">
            <Panel label={`Developer earnings (${reportingCurrency})`}>
              <Stat
                label={`Developer earnings (${reportingCurrency})`}
                value={formatCurrency(data.totals.estimatedRevenueMinor, reportingCurrency)}
              />
            </Panel>
            <Panel label={`Advertiser spend (${reportingCurrency})`}>
              <Stat
                label={`Advertiser spend (${reportingCurrency})`}
                value={formatCurrency(data.totals.advertiserSpendMinor, reportingCurrency)}
              />
            </Panel>
            <Panel label={`Paid out (${reportingCurrency})`}>
              <Stat
                label={`Paid out (${reportingCurrency})`}
                value={formatCurrency(data.totals.paidRevenueMinor, reportingCurrency)}
              />
            </Panel>
            <Panel label="Pending payouts">
              <Stat label="Pending payouts" value={formatNumber(data.payouts.pending)} />
            </Panel>
          </div>

          {/* ── Time-series charts ── */}
          {data.daily.length > 1 && (
            <div className="dash-grid dash-grid--2">
              {chartPanels.map((chart) => (
                <Panel key={chart.title} label={chart.title}>
                  <PanelHeader
                    title={
                      <>
                        {chart.title}{' '}
                        <span className="font-normal text-[var(--muted)]">
                          ({data.daily.length} days)
                        </span>
                      </>
                    }
                    action={<span className="text-xs text-[var(--muted)]">{chart.total}</span>}
                  />
                  <div className="mb-2 flex h-20 items-end gap-1">
                    <MiniBar values={chart.values} maxValue={chart.max} />
                  </div>
                  <div className="flex justify-between text-xs text-[var(--muted)]">
                    <span>{formatDateShort(data.daily[0].date)}</span>
                    <span>{formatDateShort(data.daily[data.daily.length - 1].date)}</span>
                  </div>
                </Panel>
              ))}
            </div>
          )}

          {/* ── Bottom row: campaign distribution + active users + platform revenue ── */}
          <div className="dash-grid dash-grid--3">
            {/* Campaign status distribution */}
            <Panel label="Campaigns by status">
              <PanelHeader title="Campaigns by status" />
              <div className="space-y-3">
                {/* Overall progress bar */}
                <div className="flex h-2 gap-px overflow-hidden rounded-full bg-[var(--hair)]">
                  {data.campaigns.byStatus.map((s) => {
                    const pct = (s.count / campaignTotal) * 100;
                    return (
                      <div
                        key={s.status}
                        className={`h-full bg-[var(--ink)] transition-all ${statusShade(s.status)}`}
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                {data.campaigns.byStatus.map((s) => {
                  const pct = Math.round((s.count / campaignTotal) * 100);
                  return (
                    <div key={s.status} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full bg-[var(--ink)] ${statusShade(s.status)}`}
                        />
                        <span className="text-[var(--copy)] capitalize">{s.status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="dash-mono text-[var(--ink)]">{formatNumber(s.count)}</span>
                        <span className="text-xs text-[var(--muted)]">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Active users breakdown */}
            <Panel label="Active users breakdown">
              <PanelHeader title="Active users" />
              <div className="space-y-4">
                {(
                  [
                    { label: 'Developers', count: data.activeUsers.developers },
                    { label: 'Advertisers', count: data.activeUsers.advertisers },
                    { label: 'Admins', count: data.activeUsers.admins },
                  ] as const
                ).map(({ label, count }) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-[var(--copy)]">{label}</span>
                      <span className="dash-mono text-[var(--ink)]">{formatNumber(count)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hair)]">
                      <div
                        className="h-full rounded-full bg-[var(--ink)] transition-all"
                        style={{
                          width: `${data.activeUsers.total > 0 ? (count / data.activeUsers.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[var(--hair)] pt-4">
                <span className="text-sm text-[var(--muted)]">Total</span>
                <span className="dash-mono text-lg font-semibold text-[var(--ink)]">
                  {formatNumber(data.activeUsers.total)}
                </span>
              </div>
            </Panel>

            {/* Platform revenue */}
            <Panel label="Platform revenue">
              <PanelHeader title="Platform revenue" />
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--hair)] py-2 text-sm">
                  <span className="text-[var(--copy)]">Platform fees</span>
                  <span className="dash-mono text-[var(--ink)]">
                    {formatCurrency(data.platformRevenue.platformFeeMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--hair)] py-2 text-sm">
                  <span className="text-[var(--copy)]">Fraud reserve</span>
                  <span className="dash-mono text-[var(--ink)]">
                    {formatCurrency(data.platformRevenue.fraudReserveMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 text-sm">
                  <span className="font-semibold text-[var(--ink)]">Total</span>
                  <span className="dash-mono text-base font-semibold text-[var(--ink)]">
                    {formatCurrency(data.platformRevenue.totalMinor, reportingCurrency)}
                  </span>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--hair)] pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Paid out to developers</span>
                  <span className="dash-mono text-[var(--ink)]">
                    {formatCurrency(data.payouts.totalPaidMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Total payouts processed</span>
                  <span className="dash-mono text-[var(--copy)]">
                    {formatNumber(data.payouts.total)}
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          {/* ── Daily data table (collapsible detail) ── */}
          <Panel label="Daily breakdown" flush>
            <details>
              <summary className="cursor-pointer px-[22px] py-4 text-sm font-semibold text-[var(--ink)]">
                Daily breakdown table
              </summary>
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Metrics table, scrolls horizontally"
              >
                <table className="min-w-[760px] text-xs">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Impressions</th>
                      <th className="text-right">Billable</th>
                      <th className="text-right">Signups</th>
                      <th className="text-right">Dev signups</th>
                      <th className="text-right">Adv signups</th>
                      <th className="text-right">Est. earnings ({reportingCurrency})</th>
                      <th className="text-right">Adv. spend ({reportingCurrency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td className="font-medium">{formatDateShort(d.date)}</td>
                        <td className="dash-mono text-right">{formatNumber(d.impressions)}</td>
                        <td className="dash-mono text-right">
                          {formatNumber(d.billableImpressions)}
                        </td>
                        <td className="dash-mono text-right">{formatNumber(d.signups)}</td>
                        <td className="dash-mono text-right">{formatNumber(d.developerSignups)}</td>
                        <td className="dash-mono text-right">
                          {formatNumber(d.advertiserSignups)}
                        </td>
                        <td className="dash-mono text-right">
                          {formatCurrency(d.estimatedRevenueMinor, reportingCurrency)}
                        </td>
                        <td className="dash-mono text-right">
                          {formatCurrency(d.advertiserSpendMinor, reportingCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Panel>
        </>
      )}
    </>
  );
}
