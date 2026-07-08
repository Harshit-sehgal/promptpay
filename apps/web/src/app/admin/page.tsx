'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { LoadingSpinner, StatCard } from '@/components';
import { formatCurrencyBreakdown, formatNumber } from '@/lib/format';

interface AdminOverview {
  activeUsers: number;
  activeCampaigns: number;
  totalBillableImpressions: number;
  totalPayoutsMinor: number;
  totalPayoutsByCurrency?: Record<string, number>;
  openFraudFlags: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getOverview()
      .then((res: { data: AdminOverview }) => setData(res.data))
      .catch((err: unknown) => {
        setError(getErrorMessage(err, 'Failed to load admin overview'));
      })
      .finally(() => setLoading(false));
  }, []);

  const payoutTotals = data?.totalPayoutsByCurrency ?? (data ? { USD: data.totalPayoutsMinor } : {});
  const payoutCurrencies = Object.keys(payoutTotals)
    .filter((currency) => (payoutTotals[currency] ?? 0) !== 0)
    .sort();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Platform overview</h1>
        <p className="text-ink-300 text-sm">System health and key metrics</p>
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
            <StatCard
              label="Active users"
              value={formatNumber(data.activeUsers)}
            />
            <StatCard
              label="Active campaigns"
              value={formatNumber(data.activeCampaigns)}
            />
            <StatCard
              label="Billable impressions"
              value={formatNumber(data.totalBillableImpressions)}
            />
            <StatCard
              label="Open fraud flags"
              value={formatNumber(data.openFraudFlags)}
              valueColor="text-red-400"
            />
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <h2 className="text-white font-semibold mb-4">Pending actions</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                <div>
                  <p className="text-white font-medium">Campaign approvals</p>
                  <p className="text-ink-400 text-xs">Pending review by admin</p>
                </div>
                <button
                  onClick={() => router.push('/admin/campaigns')}
                  className="text-brand-500 hover:text-brand-400 text-sm"
                >
                  Review →
                </button>
              </div>
              <div className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                <div>
                  <p className="text-white font-medium">Payout requests</p>
                  <p className="text-ink-400 text-xs">Awaiting approval</p>
                </div>
                <button
                  onClick={() => router.push('/admin/payouts')}
                  className="text-brand-500 hover:text-brand-400 text-sm"
                >
                  Review →
                </button>
              </div>
              <div className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                <div>
                  <p className="text-white font-medium">Recovery debt</p>
                  <p className="text-ink-400 text-xs">Paid-fraud debt not netted from future earnings</p>
                </div>
                <button
                  onClick={() => router.push('/admin/recovery-debt')}
                  className="text-brand-500 hover:text-brand-400 text-sm"
                >
                  Review →
                </button>
              </div>
              <div className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                <div>
                  <p className="text-white font-medium">Fraud flags</p>
                  <p className="text-ink-400 text-xs">Suspicious activity detected</p>
                </div>
                <button
                  onClick={() => router.push('/admin/fraud')}
                  className="text-brand-500 hover:text-brand-400 text-sm"
                >
                  Review →
                </button>
              </div>
            </div>
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Platform revenue</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Total payouts</p>
                <p className="text-white font-mono text-lg">{formatCurrencyBreakdown(payoutTotals)}</p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Payout currencies</p>
                <p className="text-white font-mono text-lg">
                  {payoutCurrencies.length > 0 ? payoutCurrencies.join(', ') : 'USD'}
                </p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Currency notes</p>
                <p className="text-ink-300 text-xs">Grouped by paid earnings ledger currency.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
