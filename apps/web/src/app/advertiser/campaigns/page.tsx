'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LoadingSpinner, StatusBadge, StatCard } from '@/components';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface Campaign {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  budgetSpentMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  createdAt: string;
}

interface CampaignsData {
  campaigns: Campaign[];
  total: number;
}

export default function AdvertiserCampaignsPage() {
  const [data, setData] = useState<CampaignsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    advertiserApi.getDashboard()
      .then((res: any) => {
        let campaigns = (res.data.campaigns || []) as Campaign[];
        if (statusFilter) {
          campaigns = campaigns.filter((c) => c.status === statusFilter);
        }
        setData({ campaigns, total: res.data.totalCampaigns || campaigns.length });
      })
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handlePause = async (id: string) => {
    setActionLoading(id);
    try {
      await advertiserApi.pauseCampaign(id);
      await refresh();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to pause campaign');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async (id: string) => {
    setActionLoading(id);
    try {
      await advertiserApi.resumeCampaign(id);
      await refresh();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resume campaign');
    } finally {
      setActionLoading(null);
    }
  };

  const totalBudget = data?.campaigns.reduce((sum, c) => sum + c.budgetTotalMinor, 0) || 0;
  const totalSpent = data?.campaigns.reduce((sum, c) => sum + c.budgetSpentMinor, 0) || 0;

  return (
<>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Campaigns</h1>
            <p className="text-ink-300 text-sm">Manage and review your ad campaigns</p>
          </div>
          <Link
            href="/advertiser/campaigns/new"
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New campaign
          </Link>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <StatCard label="Total campaigns" value={data.campaigns.length.toString()} />
              <StatCard label="Total budget" value={formatCurrency(totalBudget)} />
              <StatCard
                label="Budget spent"
                value={formatCurrency(totalSpent)}
                valueColor="text-brand-500"
                subtitle={totalBudget > 0 ? `${((totalSpent / totalBudget) * 100).toFixed(1)}% used` : undefined}
              />
            </div>

            {/* Filter */}
            <div className="mb-6 flex items-center gap-2">
              <span className="text-ink-400 text-sm">Status:</span>
              {['', 'draft', 'submitted', 'approved', 'active', 'paused', 'rejected', 'archived'].map(
                (status) => (
                  <button
                    key={status || 'all'}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                      statusFilter === status
                        ? 'bg-brand-500 text-white'
                        : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                    }`}
                  >
                    {status || 'All'}
                  </button>
                ),
              )}
            </div>

            {/* Campaign list */}
            {data.campaigns.length === 0 ? (
              <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
                <p className="text-ink-400 text-sm mb-4">No campaigns found.</p>
                <Link
                  href="/advertiser/campaigns/new"
                  className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Create your first campaign
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {data.campaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="bg-ink-800 border border-ink-600/30 rounded-xl p-5 hover:border-ink-600/60 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <StatusBadge status={campaign.status} />
                        <h3 className="text-white font-medium">{campaign.name}</h3>
                        <span className="text-ink-500 text-xs uppercase">{campaign.bidType}</span>
                        {campaign.status === 'approved' && !(campaign as any).creatives?.some((cr: any) => cr.status === 'approved') && (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] px-2 py-0.5 rounded-md font-medium">
                            Needs Approved Creative
                          </span>
                        )}
                        {campaign.status === 'approved' && (campaign as any).creatives?.some((cr: any) => cr.status === 'approved') && campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] px-2 py-0.5 rounded-md font-medium">
                            Insufficient Budget
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {campaign.status === 'draft' && (
                          <button
                            onClick={() => {}}
                            className="text-brand-500 hover:text-brand-400 text-xs font-medium"
                          >
                            Edit
                          </button>
                        )}
                        {campaign.status === 'approved' && (
                          <button
                            onClick={() => handlePause(campaign.id)}
                            disabled={actionLoading === campaign.id}
                            className="text-amber-400 hover:text-amber-300 text-xs font-medium disabled:opacity-50"
                          >
                            {actionLoading === campaign.id ? 'Pausing...' : 'Pause'}
                          </button>
                        )}
                        {campaign.status === 'paused' && (
                          <button
                            onClick={() => handleResume(campaign.id)}
                            disabled={actionLoading === campaign.id}
                            className="text-emerald-400 hover:text-emerald-300 text-xs font-medium disabled:opacity-50"
                          >
                            {actionLoading === campaign.id ? 'Resuming...' : 'Resume'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-ink-500 text-xs">Budget</p>
                        <p className="text-white font-mono">
                          {formatCurrency(campaign.budgetSpentMinor)} / {formatCurrency(campaign.budgetTotalMinor)}
                        </p>
                        <div className="h-1.5 bg-ink-700 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className="h-full bg-brand-500 transition-all"
                            style={{
                              width: campaign.budgetTotalMinor > 0
                                ? `${(campaign.budgetSpentMinor / campaign.budgetTotalMinor) * 100}%`
                                : '0%',
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-ink-500 text-xs">Impressions</p>
                        <p className="text-white font-mono">{campaign.impressions.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-ink-500 text-xs">Clicks</p>
                        <p className="text-white font-mono">{campaign.clicks.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-ink-500 text-xs">Created</p>
                        <p className="text-ink-300 text-xs">{formatRelativeTime(campaign.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      
</>
);
}
