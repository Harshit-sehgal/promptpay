'use client';

import { BarChart3, Megaphone, MousePointer, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatNumber, formatPercent } from '@/lib/format';

interface CreativeSummary {
  status: string;
}

interface DashboardCampaign {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  budgetSpentMinor: number;
  currency: string;
  createdAt: string;
  creatives?: CreativeSummary[];
}

interface AdvertiserData {
  totalSpendMinor: number;
  totalSpendByCurrency?: Record<string, number>;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  activeCampaigns: number;
  totalCampaigns: number;
  campaigns: DashboardCampaign[];
}

const statusBadge = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-ink-600 text-ink-200',
    submitted: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-blue-500/20 text-blue-400',
    active: 'bg-emerald-500/20 text-emerald-400',
    paused: 'bg-amber-500/20 text-amber-400',
    rejected: 'bg-red-500/20 text-red-400',
    archived: 'bg-ink-600 text-ink-400',
  };
  return colors[status] || 'bg-ink-600 text-ink-200';
};

function hasApprovedCreative(campaign: DashboardCampaign): boolean {
  return campaign.creatives?.some((creative) => creative.status === 'approved') ?? false;
}

export default function AdvertisersPage() {
  const [data, setData] = useState<AdvertiserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'cancelled'; visible: boolean } | null>(
    null,
  );

  const searchParams = useSearchParams();
  const depositStatus = searchParams.get('deposit');

  // Handle Stripe Checkout redirect (successUrl/cancelUrl in advertiser.controller.ts)
  useEffect(() => {
    if (depositStatus === 'success') {
      setBanner({ type: 'success', visible: true });
    } else if (depositStatus === 'cancelled') {
      setBanner({ type: 'cancelled', visible: true });
    }
    if (depositStatus) {
      const url = new URL(window.location.href);
      url.searchParams.delete('deposit');
      window.history.replaceState({}, '', url.toString());
    }
  }, [depositStatus]);

  const loadDashboard = () => {
    setLoading(true);
    setError(null);
    advertiserApi
      .getDashboard()
      .then((res: { data: AdvertiserData }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load dashboard')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Advertiser overview</h1>
        <p className="text-ink-200 text-sm">Your campaigns and performance</p>
      </div>

      {/* Stripe Checkout redirect banners */}
      {banner?.visible && (
        <div
          className={`mb-6 rounded-xl p-4 border ${
            banner.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-amber-500/10 border-amber-500/20'
          }`}
        >
          <div className="flex items-center gap-3">
            {banner.type === 'success' ? (
              <svg
                className="w-5 h-5 text-emerald-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5 text-amber-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${banner.type === 'success' ? 'text-emerald-300' : 'text-amber-300'}`}
              >
                {banner.type === 'success'
                  ? 'Your payment was completed. Your account balance will be credited once the payment is confirmed by our payment processor — check the billing page in a moment.'
                  : 'Deposit cancelled. No charges were made.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {banner.type === 'success' && (
                <Link
                  href="/advertiser/billing"
                  className="text-xs text-emerald-300 hover:text-emerald-200 underline underline-offset-2 transition-colors"
                >
                  View billing
                </Link>
              )}
              <button
                onClick={() => setBanner(null)}
                className="text-ink-300 hover:text-white transition-colors"
                aria-label="Dismiss"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 mb-6">
          <p className="text-red-300 text-sm">{error}</p>
          <button
            onClick={loadDashboard}
            className="text-red-300 text-xs underline mt-2 hover:text-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Total spend"
              value={formatCurrencyBreakdown(
                data.totalSpendByCurrency ?? { USD: data.totalSpendMinor },
              )}
              subtitle="Across all campaigns"
              variant="dark"
              valueColor="text-white"
              icon={<BarChart3 className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="Impressions"
              value={formatNumber(data.totalImpressions)}
              subtitle="Ad views delivered"
              variant="dark"
              valueColor="text-white"
              icon={<Users className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="Clicks"
              value={formatNumber(data.totalClicks)}
              subtitle="Qualified clicks"
              variant="dark"
              valueColor="text-white"
              icon={<MousePointer className="h-5 w-5 text-ink-300" />}
            />
            <StatCard
              label="CTR"
              value={formatPercent(data.ctr * 100, 2)}
              subtitle="Click-through rate"
              variant="dark"
              valueColor="text-white"
              icon={<Megaphone className="h-5 w-5 text-ink-300" />}
            />
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Campaigns ({data.totalCampaigns})</h2>
              <Link
                href="/advertiser/campaigns/new"
                className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
              >
                Create campaign
              </Link>
            </div>
            {data.campaigns.length > 0 ? (
              <div className="space-y-2">
                {data.campaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${statusBadge(campaign.status)}`}
                      >
                        {campaign.status}
                      </span>
                      <p className="text-white font-medium">{campaign.name}</p>
                      {campaign.status === 'approved' && !hasApprovedCreative(campaign) && (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-2 py-0.5 rounded font-medium">
                          Needs Approved Creative
                        </span>
                      )}
                      {campaign.status === 'approved' &&
                        hasApprovedCreative(campaign) &&
                        campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-2 py-0.5 rounded font-medium">
                            Insufficient Budget
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-ink-200">
                        Budget: {formatCurrency(campaign.budgetSpentMinor, campaign.currency)} /{' '}
                        {formatCurrency(campaign.budgetTotalMinor, campaign.currency)}
                      </span>
                      <span className="text-ink-200 uppercase">{campaign.bidType}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-600/30 py-12 text-center">
                <Megaphone className="h-8 w-8 text-ink-400 mb-3" />
                <p className="text-ink-300 text-sm font-medium">No campaigns yet</p>
                <p className="text-ink-400 text-xs mt-1">
                  Create your first campaign to start reaching developers.
                </p>
                <Link
                  href="/advertiser/campaigns/new"
                  className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600"
                >
                  Create campaign
                </Link>
              </div>
            )}
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Invalid traffic protection</h2>
            <p className="text-ink-200 text-sm">
              All impressions require a 5-second minimum visible duration, validated device
              fingerprint, and cleared fraud checks. Suspicious traffic is automatically flagged and
              excluded from billing.
            </p>
          </div>
        </>
      )}
    </>
  );
}
