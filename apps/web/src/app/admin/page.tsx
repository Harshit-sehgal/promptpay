'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrencyBreakdown, formatNumber } from '@/lib/format';

interface AdminOverview {
  activeUsers: number;
  activeCampaigns: number;
  totalBillableImpressions: number;
  totalPayoutsMinor: bigint;
  totalPayoutsByCurrency?: Record<string, bigint>;
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
    .filter((currency) => (payoutTotals[currency] ?? 0n) !== 0n)
    .sort();

  return (
    <>
      <PageHeader title="Platform overview" />

      {loading && (
        <div className="flex items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="dash-btn dash-btn--secondary dash-btn--sm"
            >
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}

      {data && (
        <>
          <div className="dash-grid dash-grid--4">
            <Panel label="Active users">
              <Stat label="Active users" value={formatNumber(data.activeUsers)} chip />
            </Panel>
            <Panel label="Active campaigns">
              <Stat label="Active campaigns" value={formatNumber(data.activeCampaigns)} />
            </Panel>
            <Panel label="Billable impressions">
              <Stat
                label="Billable impressions"
                value={formatNumber(data.totalBillableImpressions)}
              />
            </Panel>
            <Panel label="Open fraud flags">
              <Stat label="Open fraud flags" value={formatNumber(data.openFraudFlags)} />
            </Panel>
          </div>

          <Panel label="Pending actions" flush>
            <PanelHeader title="Pending actions" />
            <div className="dash-rows">
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
                <div key={item.href} className="grid grid-cols-[1fr_auto] items-center gap-4">
                  <div>
                    <p className="text-[15px] font-medium text-[var(--ink)]">{item.title}</p>
                    <p className="mt-0.5 text-[13px] text-[var(--muted)]">{item.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(item.href)}
                    className="dash-btn dash-btn--secondary dash-btn--sm"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel label="Platform revenue">
            <PanelHeader title="Platform revenue" />
            <div className="dash-grid dash-grid--3">
              <Stat label="Total payouts" value={formatCurrencyBreakdown(payoutTotals)} />
              <Stat
                label="Payout currencies"
                value={payoutCurrencies.length > 0 ? payoutCurrencies.join(', ') : 'USD'}
              />
              <div className="dash-stat">
                <p className="dash-stat__label">Currency notes</p>
                <p className="dash-stat__detail">Grouped by paid earnings ledger currency.</p>
              </div>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
