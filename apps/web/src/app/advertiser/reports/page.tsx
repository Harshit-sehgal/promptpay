'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, Stat, type Tone } from '@/components/dash';
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
  spendMinor: bigint;
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
    totalSpendMinor: bigint;
    totalSpendByCurrency?: Record<string, bigint>;
    avgCtr: number;
    totalCampaigns: number;
  };
}

// ── Date helpers ──

function formatDateShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function periodPreset(
  days: number,
  reference: Date = new Date(),
): { from: string; to: string } {
  const to = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: ymd(from), to: ymd(to) };
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

function MiniBar({
  values,
  maxValue,
  color,
}: {
  values: number[];
  maxValue: number;
  color: string;
}) {
  const max = Math.max(maxValue, 1);
  return (
    <div className="flex h-8 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={`w-[6px] rounded-t-sm transition-all duration-200 motion-reduce:transition-none ${color}`}
          style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
        />
      ))}
    </div>
  );
}

function statusTone(status: string): Tone {
  if (status === 'active') return 'ok';
  if (status === 'paused') return 'warn';
  return 'neutral';
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

  const fetchReportsRequestIdRef = useRef(0);

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

    // Stale-response guard: rapid filter changes fire overlapping requests;
    // only the newest one may write state, or an old response could
    // overwrite the reports for the currently selected range.
    const requestId = ++fetchReportsRequestIdRef.current;
    advertiserApi
      .getReports(params)
      .then((res: { data: ReportsData }) => {
        if (fetchReportsRequestIdRef.current !== requestId) return;
        setData(res.data);
      })
      .catch((err: unknown) => {
        if (fetchReportsRequestIdRef.current !== requestId) return;
        setError(getErrorMessage(err, 'Failed to load reports'));
      })
      .finally(() => {
        if (fetchReportsRequestIdRef.current === requestId) setLoading(false);
      });
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
      <PageHeader
        eyebrow="Advertiser"
        title="Reports"
        lede="Campaign performance, daily trends, and spend breakdown"
      />

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-[var(--muted)]">Period:</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`dash-btn dash-btn--sm ${
              period === p.key ? 'dash-btn--primary' : 'dash-btn--glass'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPeriod('custom')}
          className={`dash-btn dash-btn--sm ${
            period === 'custom' ? 'dash-btn--primary' : 'dash-btn--glass'
          }`}
        >
          Custom
        </button>

        {period === 'custom' && (
          <div className="ml-2 flex items-center gap-2">
            <input
              aria-label="Start date"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-xs text-[var(--muted)]">to</span>
            <input
              aria-label="End date"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Campaign filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--muted)]">Campaign:</span>
        <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
          <option value="">All campaigns</option>
          {data?.rows.map((r) => (
            <option key={r.campaignId} value={r.campaignId}>
              {r.campaignName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!dateRange}
          className="dash-btn dash-btn--glass dash-btn--sm ml-auto"
        >
          Export CSV
        </button>
      </div>

      {/* Loading & error */}
      {loading && <LoadingSpinner />}
      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button onClick={fetchReports} className="dash-btn dash-btn--glass dash-btn--sm">
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-5">
            <Panel label="Impressions">
              <Stat label="Impressions" value={formatNumber(displayStats!.impressions)} />
            </Panel>
            <Panel label="Clicks">
              <Stat label="Clicks" value={formatNumber(displayStats!.clicks)} />
            </Panel>
            <Panel label="Avg CTR">
              <Stat label="Avg CTR" value={formatPercent(displayStats!.ctr * 100)} />
            </Panel>
            <Panel label="Total spend">
              <Stat
                label="Total spend"
                value={formatCurrencyBreakdown(
                  displayStats!.spendByCurrency ?? { USD: displayStats!.spend },
                )}
                chip
              />
            </Panel>
            <Panel label="Campaigns">
              <Stat label="Campaigns" value={formatNumber(displayStats!.campaigns)} />
            </Panel>
          </div>

          {/* Daily trend chart */}
          {data.dailyTrend.length > 1 && (
            <div className="dash-grid dash-grid--2">
              <Panel>
                <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">
                  Daily impressions{' '}
                  <span className="font-normal text-[var(--muted)]">
                    ({data.dailyTrend.length} days)
                  </span>
                </h3>
                <div className="mb-2 flex h-20 items-end gap-1">
                  <MiniBar
                    values={data.dailyTrend.map((d) => d.impressions)}
                    maxValue={maxDailyImpressions}
                    color="bg-[var(--ink)]"
                  />
                </div>
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span>{formatDateShort(data.dailyTrend[0].date)}</span>
                  <span>{formatDateShort(data.dailyTrend[data.dailyTrend.length - 1].date)}</span>
                </div>
              </Panel>
              <Panel>
                <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">
                  Daily clicks{' '}
                  <span className="font-normal text-[var(--muted)]">
                    ({data.dailyTrend.length} days)
                  </span>
                </h3>
                <div className="mb-2 flex h-20 items-end gap-1">
                  <MiniBar
                    values={data.dailyTrend.map((d) => d.clicks)}
                    maxValue={maxDailyClicks}
                    color="bg-[var(--ink)]"
                  />
                </div>
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span>{formatDateShort(data.dailyTrend[0].date)}</span>
                  <span>{formatDateShort(data.dailyTrend[data.dailyTrend.length - 1].date)}</span>
                </div>
              </Panel>
            </div>
          )}

          {/* Campaign breakdown table */}
          <Panel label="Campaign breakdown" flush>
            <PanelHeader
              title="Campaign breakdown"
              action={
                data.rows.length > 0 ? (
                  <span className="text-xs text-[var(--muted)]">
                    {data.rows.length} campaign{data.rows.length !== 1 ? 's' : ''}
                  </span>
                ) : undefined
              }
            />

            {data.rows.length === 0 ? (
              <div className="px-[22px] py-12 text-center text-sm text-[var(--muted)]">
                No data for this period. Campaigns need to be active to generate reports.
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="dash-eyebrow hidden grid-cols-12 gap-2 border-b border-[var(--hair)] px-[22px] py-3 md:grid">
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
                      className="grid grid-cols-1 gap-2 border-b border-[var(--hair)] px-[22px] py-4 md:grid-cols-12"
                    >
                      {/* Campaign name (full width on mobile) */}
                      <div className="md:col-span-3">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {row.campaignName}
                        </p>
                      </div>

                      {/* Metrics */}
                      <div className="grid grid-cols-2 gap-2 md:col-span-7 md:grid-cols-4">
                        <div>
                          <span className="dash-eyebrow block md:hidden">Impressions</span>
                          <span className="dash-mono text-sm text-[var(--ink)]">
                            {formatNumber(row.impressions)}
                          </span>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--hair)] md:hidden">
                            <div
                              className="h-full rounded-full bg-[var(--ink)]"
                              style={{ width: `${impShare}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <span className="dash-eyebrow block md:hidden">Clicks</span>
                          <span className="dash-mono text-sm text-[var(--ink)]">
                            {formatNumber(row.clicks)}
                          </span>
                        </div>
                        <div>
                          <span className="dash-eyebrow block md:hidden">CTR</span>
                          <span className="dash-mono text-sm text-[var(--ink)]">
                            {formatPercent(row.ctr * 100)}
                          </span>
                        </div>
                        <div>
                          <span className="dash-eyebrow block md:hidden">Spend</span>
                          <span className="dash-mono text-sm text-[var(--ink)]">
                            {formatCurrency(row.spendMinor, row.currency)}
                          </span>
                        </div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center justify-end md:col-span-2">
                        <Pill tone={statusTone(row.status)}>{row.status}</Pill>
                      </div>

                      {/* Impression share bar (desktop) */}
                      <div className="mb-1 -mt-2 hidden md:col-span-12 md:block">
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--hair)]">
                          <div
                            className="h-full rounded-full bg-[var(--ink)] transition-all motion-reduce:transition-none"
                            style={{ width: `${impShare}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Totals row */}
                <div className="grid grid-cols-1 gap-2 px-[22px] py-4 md:grid-cols-12">
                  <div className="md:col-span-3">
                    <p className="text-sm font-semibold text-[var(--ink)]">Total</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:col-span-7 md:grid-cols-4">
                    <span className="dash-mono text-sm font-semibold text-[var(--ink)]">
                      {formatNumber(data.summary.totalImpressions)}
                    </span>
                    <span className="dash-mono text-sm text-[var(--ink)]">
                      {formatNumber(data.summary.totalClicks)}
                    </span>
                    <span className="dash-mono text-sm text-[var(--ink)]">
                      {formatPercent(data.summary.avgCtr * 100)}
                    </span>
                    <span className="dash-mono text-sm font-semibold text-[var(--ink)]">
                      {formatCurrencyBreakdown(
                        data.summary.totalSpendByCurrency ?? { USD: data.summary.totalSpendMinor },
                      )}
                    </span>
                  </div>
                  <div className="md:col-span-2" />
                </div>
              </>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
