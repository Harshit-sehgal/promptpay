'use client';

import { useCallback, useMemo, useState } from 'react';
import { useEffect } from 'react';
import { adminApi } from '@/lib/api/services';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';

// ── Types ──

interface DailyPoint {
  date: string;
  impressions: number;
  billableImpressions: number;
  signups: number;
  developerSignups: number;
  advertiserSignups: number;
  estimatedRevenueMinor: number;
  confirmedRevenueMinor: number;
  paidRevenueMinor: number;
  advertiserSpendMinor: number;
}

interface MetricsData {
  currency?: string;
  period: { days: number; from: string; to: string };
  daily: DailyPoint[];
  totals: {
    impressions: number;
    billableImpressions: number;
    signups: number;
    estimatedRevenueMinor: number;
    confirmedRevenueMinor: number;
    paidRevenueMinor: number;
    advertiserSpendMinor: number;
  };
  vsPreviousPeriod: {
    impressionsChangePct: number | null;
    signupsChangePct: number | null;
    revenueChangePct: number | null;
  };
  activeUsers: { developers: number; advertisers: number; admins: number; total: number };
  campaigns: { byStatus: { status: string; count: number }[]; total: number };
  payouts: { total: number; pending: number; totalPaidMinor: number };
  platformRevenue: { platformFeeMinor: number; fraudReserveMinor: number; totalMinor: number };
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

function MiniBar({ values, maxValue, color }: { values: number[]; maxValue: number; color: string }) {
  const max = Math.max(maxValue, 1);
  return (
    <div className="flex items-end gap-[2px] h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className={`w-[6px] rounded-t-sm transition-all duration-200 ${color}`}
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
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

  const fetchMetrics = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getMetrics(selectedDays)
      .then((res: { data: MetricsData }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load metrics')))
      .finally(() => setLoading(false));
  }, [selectedDays]);

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
    () => Math.max(...(data?.daily.map((d) => d.estimatedRevenueMinor) ?? [1]), 1),
    [data],
  );
  const maxSpend = useMemo(
    () => Math.max(...(data?.daily.map((d) => d.advertiserSpendMinor) ?? [1]), 1),
    [data],
  );

  // Campaign status totals for distribution bar
  const campaignTotal = data?.campaigns.total ?? 1;
  const reportingCurrency = data?.currency ?? 'USD';

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Operational Metrics</h1>
        <p className="text-ink-300 text-sm">
          Platform health, growth trends, and revenue breakdown
        </p>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-ink-400 text-sm mr-1">Period:</span>
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setSelectedDays(p.days)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedDays === p.days
                ? 'bg-brand-500 text-white'
                : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-ink-500 text-xs ml-2">
          {data ? `${formatDateShort(data.period.from)} – ${formatDateShort(data.period.to)}` : ''}
        </span>
      </div>

      {/* Loading & error */}
      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={fetchMetrics} className="text-red-300 text-xs underline mt-1">
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* ── Summary stat cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Impressions"
              value={formatNumber(data.totals.impressions)}
              subtitle={data.vsPreviousPeriod.impressionsChangePct !== null ? `${data.vsPreviousPeriod.impressionsChangePct > 0 ? '↑' : '↓'} ${Math.abs(data.vsPreviousPeriod.impressionsChangePct).toFixed(1)}% vs prior period` : undefined}
            />
            <StatCard
              label="Billable %"
              value={
                data.totals.impressions > 0
                  ? formatPercent((data.totals.billableImpressions / data.totals.impressions) * 100)
                  : '—'
              }
            />
            <StatCard
              label="Signups"
              value={formatNumber(data.totals.signups)}
              subtitle={data.vsPreviousPeriod.signupsChangePct !== null ? `${data.vsPreviousPeriod.signupsChangePct > 0 ? '↑' : '↓'} ${Math.abs(data.vsPreviousPeriod.signupsChangePct).toFixed(1)}% vs prior period` : undefined}
            />
            <StatCard
              label="Active users"
              value={formatNumber(data.activeUsers.total)}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label={`Developer earnings (${reportingCurrency})`}
              value={formatCurrency(data.totals.estimatedRevenueMinor, reportingCurrency)}
            />
            <StatCard
              label={`Advertiser spend (${reportingCurrency})`}
              value={formatCurrency(data.totals.advertiserSpendMinor, reportingCurrency)}
            />
            <StatCard
              label={`Paid out (${reportingCurrency})`}
              value={formatCurrency(data.totals.paidRevenueMinor, reportingCurrency)}
            />
            <StatCard
              label="Pending payouts"
              value={formatNumber(data.payouts.pending)}
              valueColor="text-amber-400"
            />
          </div>

          {/* ── Time-series charts ── */}
          {data.daily.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Daily impressions */}
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white text-sm font-semibold">
                    Daily impressions{' '}
                    <span className="text-ink-400 font-normal">
                      ({data.daily.length} days)
                    </span>
                  </h3>
                  <span className="text-ink-400 text-xs">
                    {formatNumber(data.totals.impressions)} total
                  </span>
                </div>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.daily.map((d) => d.impressions)}
                    maxValue={maxImpressions}
                    color="bg-brand-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.daily[0].date)}</span>
                  <span>{formatDateShort(data.daily[data.daily.length - 1].date)}</span>
                </div>
              </div>

              {/* Daily signups */}
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white text-sm font-semibold">
                    Daily signups{' '}
                    <span className="text-ink-400 font-normal">
                      ({data.daily.length} days)
                    </span>
                  </h3>
                  <span className="text-ink-400 text-xs">
                    {formatNumber(data.totals.signups)} total
                  </span>
                </div>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.daily.map((d) => d.signups)}
                    maxValue={maxSignups}
                    color="bg-emerald-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.daily[0].date)}</span>
                  <span>{formatDateShort(data.daily[data.daily.length - 1].date)}</span>
                </div>
              </div>

              {/* Daily developer earnings */}
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white text-sm font-semibold">
                    Daily earnings (estimated){' '}
                    <span className="text-ink-400 font-normal">
                      ({data.daily.length} days)
                    </span>
                  </h3>
                  <span className="text-ink-400 text-xs">
                    {formatCurrency(data.totals.estimatedRevenueMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.daily.map((d) => d.estimatedRevenueMinor)}
                    maxValue={maxRevenue}
                    color="bg-violet-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.daily[0].date)}</span>
                  <span>{formatDateShort(data.daily[data.daily.length - 1].date)}</span>
                </div>
              </div>

              {/* Daily advertiser spend */}
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white text-sm font-semibold">
                    Daily advertiser spend{' '}
                    <span className="text-ink-400 font-normal">
                      ({data.daily.length} days)
                    </span>
                  </h3>
                  <span className="text-ink-400 text-xs">
                    {formatCurrency(data.totals.advertiserSpendMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.daily.map((d) => d.advertiserSpendMinor)}
                    maxValue={maxSpend}
                    color="bg-amber-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.daily[0].date)}</span>
                  <span>{formatDateShort(data.daily[data.daily.length - 1].date)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Bottom row: campaign distribution + active users + platform revenue ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* Campaign status distribution */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
              <h3 className="text-white text-sm font-semibold mb-4">Campaigns by status</h3>
              <div className="space-y-3">
                {/* Overall progress bar */}
                <div className="h-2 bg-ink-700 rounded-full overflow-hidden flex">
                  {data.campaigns.byStatus.map((s) => {
                    const pct = (s.count / campaignTotal) * 100;
                    const color =
                      s.status === 'active'
                        ? 'bg-emerald-500'
                        : s.status === 'draft'
                        ? 'bg-ink-500'
                        : s.status === 'submitted'
                        ? 'bg-blue-500'
                        : s.status === 'paused'
                        ? 'bg-amber-500'
                        : s.status === 'archived'
                        ? 'bg-ink-600'
                        : 'bg-ink-400';
                    return (
                      <div
                        key={s.status}
                        className={`${color} h-full transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                {data.campaigns.byStatus.map((s) => {
                  const pct = Math.round((s.count / campaignTotal) * 100);
                  const dot =
                    s.status === 'active'
                      ? 'bg-emerald-500'
                      : s.status === 'draft'
                      ? 'bg-ink-500'
                      : s.status === 'submitted'
                      ? 'bg-blue-500'
                      : s.status === 'paused'
                      ? 'bg-amber-500'
                      : s.status === 'archived'
                      ? 'bg-ink-600'
                      : 'bg-ink-400';
                  return (
                    <div key={s.status} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-ink-300 capitalize">{s.status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-mono">{formatNumber(s.count)}</span>
                        <span className="text-ink-500 text-xs">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active users breakdown */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
              <h3 className="text-white text-sm font-semibold mb-4">Active users</h3>
              <div className="space-y-4">
                {([
                  { label: 'Developers', count: data.activeUsers.developers, color: 'bg-brand-500' },
                  { label: 'Advertisers', count: data.activeUsers.advertisers, color: 'bg-emerald-500' },
                  { label: 'Admins', count: data.activeUsers.admins, color: 'bg-red-500' },
                ] as const).map(({ label, count, color }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-ink-300">{label}</span>
                      <span className="text-white font-mono">{formatNumber(count)}</span>
                    </div>
                    <div className="h-1.5 bg-ink-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all`}
                        style={{
                          width: `${data.activeUsers.total > 0 ? (count / data.activeUsers.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-ink-600/20 flex items-center justify-between">
                <span className="text-ink-400 text-sm">Total</span>
                <span className="text-white font-mono text-lg font-semibold">
                  {formatNumber(data.activeUsers.total)}
                </span>
              </div>
            </div>

            {/* Platform revenue */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
              <h3 className="text-white text-sm font-semibold mb-4">Platform revenue</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm py-2 border-b border-ink-600/10">
                  <span className="text-ink-300">Platform fees</span>
                  <span className="text-white font-mono">
                    {formatCurrency(data.platformRevenue.platformFeeMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm py-2 border-b border-ink-600/10">
                  <span className="text-ink-300">Fraud reserve</span>
                  <span className="text-white font-mono">
                    {formatCurrency(data.platformRevenue.fraudReserveMinor, reportingCurrency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm py-2">
                  <span className="text-ink-200 font-semibold">Total</span>
                  <span className="text-brand-400 font-mono text-base font-semibold">
                    {formatCurrency(data.platformRevenue.totalMinor, reportingCurrency)}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-ink-600/20">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-400">Paid out to developers</span>
                  <span className="text-white font-mono">{formatCurrency(data.payouts.totalPaidMinor, reportingCurrency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-ink-400">Total payouts processed</span>
                  <span className="text-ink-300 font-mono">{formatNumber(data.payouts.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Daily data table (collapsible detail) ── */}
          <details className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
            <summary className="px-6 py-4 text-white text-sm font-semibold cursor-pointer hover:bg-ink-700/30 transition-colors">
              Daily breakdown table
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-ink-700/30 text-ink-400 font-medium uppercase tracking-wider">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-4 py-2">Impressions</th>
                    <th className="text-right px-4 py-2">Billable</th>
                    <th className="text-right px-4 py-2">Signups</th>
                    <th className="text-right px-4 py-2">Dev signups</th>
                    <th className="text-right px-4 py-2">Adv signups</th>
                    <th className="text-right px-4 py-2">Est. earnings ({reportingCurrency})</th>
                    <th className="text-right px-4 py-2">Adv. spend ({reportingCurrency})</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr
                      key={d.date}
                      className="border-t border-ink-600/10 hover:bg-ink-700/20 transition-colors"
                    >
                      <td className="px-4 py-2 text-ink-300 font-medium">
                        {formatDateShort(d.date)}
                      </td>
                      <td className="px-4 py-2 text-white font-mono text-right">
                        {formatNumber(d.impressions)}
                      </td>
                      <td className="px-4 py-2 text-ink-300 font-mono text-right">
                        {formatNumber(d.billableImpressions)}
                      </td>
                      <td className="px-4 py-2 text-white font-mono text-right">
                        {formatNumber(d.signups)}
                      </td>
                      <td className="px-4 py-2 text-ink-300 font-mono text-right">
                        {formatNumber(d.developerSignups)}
                      </td>
                      <td className="px-4 py-2 text-ink-300 font-mono text-right">
                        {formatNumber(d.advertiserSignups)}
                      </td>
                      <td className="px-4 py-2 text-violet-400 font-mono text-right">
                        {formatCurrency(d.estimatedRevenueMinor, reportingCurrency)}
                      </td>
                      <td className="px-4 py-2 text-amber-400 font-mono text-right">
                        {formatCurrency(d.advertiserSpendMinor, reportingCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}
