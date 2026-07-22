'use client';

import { AlertTriangle, BarChart3, DollarSign, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
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

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getOverview();
      setData(res.data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load admin overview'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const payoutTotals =
    data?.totalPayoutsByCurrency ?? (data ? { USD: data.totalPayoutsMinor } : {});
  const payoutCurrencies = Object.keys(payoutTotals)
    .filter((currency) => (payoutTotals[currency] ?? 0) !== 0)
    .sort();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Platform overview</h1>
        <p className="text-ink-200 text-sm">System health and key metrics</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 mb-6 flex items-center justify-between">
          <p className="text-red-300 text-sm">{error}</p>
          <button
            onClick={() => void loadOverview()}
            className="text-xs font-medium text-red-300 transition-colors hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Active users"
              value={formatNumber(data.activeUsers)}
              variant="dark"
              valueColor="text-white"
              icon={<Users className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="Active campaigns"
              value={formatNumber(data.activeCampaigns)}
              variant="dark"
              valueColor="text-white"
              icon={<BarChart3 className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="Billable impressions"
              value={formatNumber(data.totalBillableImpressions)}
              variant="dark"
              valueColor="text-white"
              icon={<DollarSign className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="Open fraud flags"
              value={formatNumber(data.openFraudFlags)}
              valueColor="text-red-400"
              variant="dark"
              icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
            />
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <h2 className="text-white font-semibold mb-4">Pending actions</h2>
            <div className="space-y-3">
              {[
                {
                  title: 'Campaign approvals',
                  detail: 'Pending review by admin',
                  href: '/admin/campaigns',
                },
                { title: 'Payout requests', detail: 'Awaiting approval', href: '/admin/payouts' },
                {
                  title: 'Recovery debt',
                  detail: 'Paid-fraud debt not netted from future earnings',
                  href: '/admin/recovery-debt',
                },
                {
                  title: 'Fraud flags',
                  detail: 'Suspicious activity detected',
                  href: '/admin/fraud',
                },
              ].map((item) => (
                <div
                  key={item.href}
                  className="flex items-center justify-between rounded-lg bg-ink-700/50 p-4 transition-colors hover:bg-ink-700"
                >
                  <div>
                    <p className="text-white font-medium">{item.title}</p>
                    <p className="text-ink-300 text-xs">{item.detail}</p>
                  </div>
                  <button
                    onClick={() => router.push(item.href)}
                    className="text-brand-400 hover:text-brand-300 text-sm font-medium transition-colors"
                  >
                    Review →
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Platform revenue</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-ink-300 text-xs uppercase tracking-wider">Total payouts</p>
                <p className="text-white font-mono text-lg">
                  {formatCurrencyBreakdown(payoutTotals)}
                </p>
              </div>
              <div>
                <p className="text-ink-300 text-xs uppercase tracking-wider">Payout currencies</p>
                <p className="text-white font-mono text-lg">
                  {payoutCurrencies.length > 0 ? payoutCurrencies.join(', ') : 'USD'}
                </p>
              </div>
              <div>
                <p className="text-ink-300 text-xs uppercase tracking-wider">Currency notes</p>
                <p className="text-ink-200 text-xs">Grouped by paid earnings ledger currency.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
