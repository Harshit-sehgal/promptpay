'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatNumber, formatPercent } from '@/lib/format';

// ── Types ──

interface ReportRow {
  campaignId: string;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spendMinor: number;
  currency: string;
}

interface DailyPoint {
  date: string;
  impressions: number;
  clicks: number;
}

interface ReportsData {
  rows: ReportRow[];
  dailyTrend: DailyPoint[];
  summary: {
    totalImpressions: number;
    totalClicks: number;
    totalSpendMinor: number;
    totalSpendByCurrency?: Record<string, number>;
    avgCtr: number;
    totalCampaigns: number;
  };
}

// ── Date helpers ──

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function periodPreset(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const PRESETS = [
  // All presets use calendar-day (date-only) bounds; the backend treats a
  // date-only `to` as inclusive through that calendar day. Labeling matches
  // the actual calendar-day semantics rather than a misleading rolling "Last
  // 24h" window (A-067).
  { key: '1d' as const, label: '1 day', days: 1 },
  { key: '7d' as const, label: '7 days', days: 7 },
  { key: '30d' as const, label: '30 days', days: 30 },
  { key: '90d' as const, label: '90 days', days: 90 },
] as const;

// ── Mini bar chart ──

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

export default function AdvertiserReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [period, setPeriod] = useState<'1d' | '7d' | '30d' | '90d' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  // ── Date range ──

  const dateRange = useMemo(() => {
    if (period === 'custom') {
      if (!customFrom || !customTo) return null;
      return { from: customFrom, to: customTo };
    }
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
    return periodPreset(days);
  }, [period, customFrom, customTo]);

  // ── Data fetching ──

  const handleExportCsv = useCallback(() => {
    if (!dateRange) return;
    const params = new URLSearchParams({
      from: dateRange.from,
      to: dateRange.to,
      format: 'csv',
    });
    if (campaignFilter) params.set('campaignId', campaignFilter);
    const a = document.createElement('a');
    a.href = `/api/advertiser/reports/export?${params.toString()}`;
    a.download = 'campaign-report.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [dateRange, campaignFilter]);

  const fetchReports = useCallback(() => {
    if (!dateRange) return;
    setLoading(true);
    setError(null);

    const params: Record<string, string> = {
      from: dateRange.from,
      to: dateRange.to,
    };
    if (campaignFilter) params.campaignId = campaignFilter;

    advertiserApi.getReports(params)
      .then((res: { data: ReportsData }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load reports')))
      .finally(() => setLoading(false));
  }, [dateRange, campaignFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Derived stats object to avoid accessing data.summary.x everywhere
  const displayStats = useMemo(() => {
    if (!data) return null;
    const { summary } = data;
    return {
      impressions: summary.totalImpressions,
      clicks: summary.totalClicks,
      ctr: summary.avgCtr,
      spend: summary.totalSpendMinor,
      spendByCurrency: summary.totalSpendByCurrency,
      campaigns: summary.totalCampaigns,
    };
  }, [data]);

  // Max values for bar charts
  const maxDailyImpressions = useMemo(() => {
    if (!data?.dailyTrend.length) return 0;
    return Math.max(...data.dailyTrend.map((d) => d.impressions), 1);
  }, [data]);

  const maxDailyClicks = useMemo(() => {
    if (!data?.dailyTrend.length) return 0;
    return Math.max(...data.dailyTrend.map((d) => d.clicks), 1);
  }, [data]);

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Reports</h1>
        <p className="text-ink-300 text-sm">
          Campaign performance, daily trends, and spend breakdown
        </p>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-ink-400 text-sm mr-1">Period:</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              period === p.key
                ? 'bg-brand-500 text-white'
                : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPeriod('custom')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            period === 'custom'
              ? 'bg-brand-500 text-white'
              : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
          }`}
        >
          Custom
        </button>

        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
            />
            <span className="text-ink-400 text-xs">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
            />
          </div>
        )}
      </div>

      {/* Campaign filter */}
      <div className="mb-6 flex items-center gap-2">
        <span className="text-ink-400 text-xs">Campaign:</span>
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-ink-700 border border-ink-600/50 rounded-lg px-2.5 py-1.5 text-xs text-ink-200 focus:outline-none focus:border-brand-500"
        >
          <option value="">All campaigns</option>
          {data?.rows.map((r) => (
            <option key={r.campaignId} value={r.campaignId}>{r.campaignName}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!dateRange}
          className="ml-auto bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Loading & error */}
      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-red-300 text-xs underline mt-1">Dismiss</button>
        </div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6">
            <StatCard
              label="Impressions"
              value={formatNumber(displayStats!.impressions)}
            />
            <StatCard
              label="Clicks"
              value={formatNumber(displayStats!.clicks)}
            />
            <StatCard
              label="Avg CTR"
              value={formatPercent(displayStats!.ctr * 100)}
            />
            <StatCard
              label="Total spend"
              value={formatCurrencyBreakdown(displayStats!.spendByCurrency ?? { USD: displayStats!.spend })}
              valueColor="text-brand-500"
            />
            <StatCard
              label="Campaigns"
              value={formatNumber(displayStats!.campaigns)}
            />
          </div>

          {/* Daily trend chart */}
          {data.dailyTrend.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <h3 className="text-white text-sm font-semibold mb-3">
                  Daily impressions <span className="text-ink-400 font-normal">({data.dailyTrend.length} days)</span>
                </h3>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.dailyTrend.map((d) => d.impressions)}
                    maxValue={maxDailyImpressions}
                    color="bg-brand-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.dailyTrend[0].date)}</span>
                  <span>{formatDateShort(data.dailyTrend[data.dailyTrend.length - 1].date)}</span>
                </div>
              </div>
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <h3 className="text-white text-sm font-semibold mb-3">
                  Daily clicks <span className="text-ink-400 font-normal">({data.dailyTrend.length} days)</span>
                </h3>
                <div className="flex items-end gap-1 h-20 mb-2">
                  <MiniBar
                    values={data.dailyTrend.map((d) => d.clicks)}
                    maxValue={maxDailyClicks}
                    color="bg-emerald-500"
                  />
                </div>
                <div className="flex justify-between text-ink-500 text-[10px]">
                  <span>{formatDateShort(data.dailyTrend[0].date)}</span>
                  <span>{formatDateShort(data.dailyTrend[data.dailyTrend.length - 1].date)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Campaign breakdown table */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-ink-600/30 flex items-center justify-between">
              <h2 className="text-white font-semibold">Campaign breakdown</h2>
              {data.rows.length > 0 && (
                <span className="text-ink-400 text-xs">
                  {data.rows.length} campaign{data.rows.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {data.rows.length === 0 ? (
              <div className="text-ink-400 text-sm py-12 text-center">
                No data for this period. Campaigns need to be active to generate reports.
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="hidden md:grid grid-cols-12 gap-2 px-6 py-3 bg-ink-700/30 border-b border-ink-600/20 text-ink-400 text-xs font-medium uppercase tracking-wider">
                  <div className="col-span-3">Campaign</div>
                  <div className="col-span-2 text-right">Impressions</div>
                  <div className="col-span-2 text-right">Clicks</div>
                  <div className="col-span-1 text-right">CTR</div>
                  <div className="col-span-2 text-right">Spend</div>
                  <div className="col-span-2 text-right">Status</div>
                </div>

                {/* Table rows */}
                {data.rows.map((row) => {
                  const totalImps = data.summary.totalImpressions || 1;
                  const impShare = (row.impressions / totalImps) * 100;
                  return (
                    <div
                      key={row.campaignId}
                      className="grid grid-cols-1 md:grid-cols-12 gap-2 px-6 py-4 border-b border-ink-600/10 hover:bg-ink-700/20 transition-colors"
                    >
                      {/* Campaign name (full width on mobile) */}
                      <div className="md:col-span-3">
                        <p className="text-white text-sm font-medium truncate">{row.campaignName}</p>
                      </div>

                      {/* Metrics */}
                      <div className="grid grid-cols-2 md:col-span-7 md:grid-cols-4 gap-2">
                        <div>
                          <span className="md:hidden text-ink-400 text-[10px] uppercase block">Impressions</span>
                          <span className="text-white font-mono text-sm">{formatNumber(row.impressions)}</span>
                          <div className="h-1 bg-ink-700 rounded-full mt-1 overflow-hidden md:hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${impShare}%` }} />
                          </div>
                        </div>
                        <div>
                          <span className="md:hidden text-ink-400 text-[10px] uppercase block">Clicks</span>
                          <span className="text-ink-300 font-mono text-sm">{formatNumber(row.clicks)}</span>
                        </div>
                        <div>
                          <span className="md:hidden text-ink-400 text-[10px] uppercase block">CTR</span>
                          <span className={`font-mono text-sm ${row.ctr > 1 ? 'text-emerald-400' : 'text-ink-300'}`}>
                            {formatPercent(row.ctr * 100)}
                          </span>
                        </div>
                        <div>
                          <span className="md:hidden text-ink-400 text-[10px] uppercase block">Spend</span>
                          <span className="text-white font-mono text-sm">
                            {formatCurrency(row.spendMinor, row.currency)}
                          </span>
                        </div>
                      </div>

                      {/* Status */}
                      <div className="md:col-span-2 flex items-center justify-end">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                          row.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                          row.status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
                          row.status === 'archived' ? 'bg-ink-600 text-ink-400' :
                          'bg-ink-600 text-ink-300'
                        }`}>
                          {row.status}
                        </span>
                      </div>

                      {/* Impression share bar (desktop) */}
                      <div className="md:col-span-12 -mt-2 mb-1 hidden md:block">
                        <div className="h-1 bg-ink-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500/60 rounded-full transition-all"
                            style={{ width: `${impShare}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Totals row */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 px-6 py-4 bg-ink-700/40">
                  <div className="md:col-span-3">
                    <p className="text-white text-sm font-semibold">Total</p>
                  </div>
                  <div className="grid grid-cols-2 md:col-span-7 md:grid-cols-4 gap-2">
                    <span className="text-white font-mono text-sm font-semibold">{formatNumber(data.summary.totalImpressions)}</span>
                    <span className="text-ink-300 font-mono text-sm">{formatNumber(data.summary.totalClicks)}</span>
                    <span className="text-ink-300 font-mono text-sm">{formatPercent(data.summary.avgCtr * 100)}</span>
                    <span className="text-white font-mono text-sm font-semibold">
                      {formatCurrencyBreakdown(data.summary.totalSpendByCurrency ?? { USD: data.summary.totalSpendMinor })}
                    </span>
                  </div>
                  <div className="md:col-span-2" />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
