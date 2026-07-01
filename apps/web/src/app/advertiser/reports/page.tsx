'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatNumber, formatPercent, formatDate } from '@/lib/format';

interface ReportRow {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spendMinor: number;
  currency: string;
  period: string;
}

interface ReportsData {
  rows: ReportRow[];
  summary: {
    totalImpressions: number;
    totalClicks: number;
    totalSpendMinor: number;
    avgCtr: number;
  };
}

export default function AdvertiserReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('7d');

  useEffect(() => {
    setLoading(true);
    advertiserApi.getReports({ period })
      .then((res: any) => setData(res.data))
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load reports'))
      .finally(() => setLoading(false));
  }, [period]);

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Reports</h1>
          <p className="text-ink-300 text-sm">Performance breakdown by campaign</p>
        </div>

        {/* Period selector */}
        <div className="mb-6 flex items-center gap-2">
          <span className="text-ink-400 text-sm">Period:</span>
          {['1d', '7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                period === p
                  ? 'bg-brand-500 text-white'
                  : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
              }`}
            >
              {p === '1d' ? 'Last 24h' : `Last ${p.replace('d', ' days')}`}
            </button>
          ))}
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <StatCard label="Impressions" value={formatNumber(data.summary.totalImpressions)} />
              <StatCard label="Clicks" value={formatNumber(data.summary.totalClicks)} />
              <StatCard label="Avg CTR" value={formatPercent(data.summary.avgCtr)} />
              <StatCard
                label="Total spend"
                value={formatCurrency(data.summary.totalSpendMinor)}
                valueColor="text-brand-500"
              />
            </div>

            <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
              {data.rows.length === 0 ? (
                <div className="text-ink-400 text-sm py-12 text-center">
                  No data for this period. Campaigns need to be active to generate reports.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-ink-700/50 border-b border-ink-600/30">
                    <tr>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Campaign</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Impressions</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Clicks</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">CTR</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-600/20">
                    {data.rows.map((row) => (
                      <tr key={row.campaignId} className="hover:bg-ink-700/30 transition-colors">
                        <td className="px-4 py-3 text-white">{row.campaignName}</td>
                        <td className="px-4 py-3 text-right text-ink-300 font-mono">
                          {formatNumber(row.impressions)}
                        </td>
                        <td className="px-4 py-3 text-right text-ink-300 font-mono">
                          {formatNumber(row.clicks)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span className={row.ctr > 1 ? 'text-emerald-400' : 'text-ink-300'}>
                            {formatPercent(row.ctr)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-white">
                          {formatCurrency(row.spendMinor, row.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      
</>
);
}
