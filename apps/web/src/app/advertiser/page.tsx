'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { LoadingSpinner } from '@/components';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';

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

  useEffect(() => {
    advertiserApi.getDashboard()
      .then((res: { data: AdvertiserData }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load dashboard')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Advertiser overview</h1>
        <p className="text-ink-300 text-sm">Your campaigns and performance</p>
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
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Total spend</p>
              <p className="text-3xl font-bold text-white font-mono">{formatCurrency(data.totalSpendMinor)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Impressions</p>
              <p className="text-3xl font-bold text-white font-mono">{formatNumber(data.totalImpressions)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Clicks</p>
              <p className="text-3xl font-bold text-white font-mono">{formatNumber(data.totalClicks)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">CTR</p>
              <p className="text-3xl font-bold text-white font-mono">{formatPercent(data.ctr * 100, 2)}</p>
            </div>
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Campaigns ({data.totalCampaigns})</h2>
              <a href="/advertiser/campaigns/new" className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Create campaign
              </a>
            </div>
            {data.campaigns.length > 0 ? (
              <div className="space-y-2">
                {data.campaigns.map((campaign) => (
                  <div key={campaign.id} className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statusBadge(campaign.status)}`}>
                        {campaign.status}
                      </span>
                      <p className="text-white font-medium">{campaign.name}</p>
                      {campaign.status === 'approved' && !hasApprovedCreative(campaign) && (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] px-2 py-0.5 rounded font-medium">
                          Needs Approved Creative
                        </span>
                      )}
                      {campaign.status === 'approved' && hasApprovedCreative(campaign) && campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] px-2 py-0.5 rounded font-medium">
                          Insufficient Budget
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-ink-300">
                        Budget: {formatCurrency(campaign.budgetSpentMinor)} / {formatCurrency(campaign.budgetTotalMinor)}
                      </span>
                      <span className="text-ink-300 uppercase">{campaign.bidType}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-ink-400 text-sm py-8 text-center border border-dashed border-ink-600/30 rounded-lg">
                No campaigns yet. Create your first campaign to start reaching developers.
              </div>
            )}
          </div>

          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Invalid traffic protection</h2>
            <p className="text-ink-300 text-sm">
              All impressions require a 5-second minimum visible duration, validated device fingerprint,
              and cleared fraud checks. Suspicious traffic is automatically flagged and excluded from billing.
            </p>
          </div>
        </>
      )}
    </>
  );
}
