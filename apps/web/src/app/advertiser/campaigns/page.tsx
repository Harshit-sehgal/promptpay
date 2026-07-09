'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatCard, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

import { getCampaignActions, getCampaignRejectionMessage } from './campaign-actions';

interface CreativeSummary {
  status: string;
  rejectionReason?: string | null;
}

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
  rejectionReason?: string | null;
  creatives?: CreativeSummary[];
}

interface CampaignsData {
  campaigns: Campaign[];
  total: number;
}

function hasApprovedCreative(campaign: Campaign): boolean {
  return campaign.creatives?.some((creative) => creative.status === 'approved') ?? false;
}

export default function AdvertiserCampaignsPage() {
  const [data, setData] = useState<CampaignsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  const isActionLoading = (action: 'pause' | 'resume' | 'archive', id: string) =>
    actionLoading === `${action}:${id}`;
  const isCampaignBusy = (id: string) => actionLoading?.endsWith(`:${id}`) ?? false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // A-074: use the bounded, paginated campaign list endpoint instead of
      // loading the entire dashboard and filtering client-side.
      const res = await advertiserApi.listCampaigns({
        page,
        limit,
        status: statusFilter || undefined,
      });
      setData({ campaigns: res.data.campaigns || [], total: res.data.total ?? 0 });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePause = async (id: string) => {
    setActionLoading(`pause:${id}`);
    try {
      await advertiserApi.pauseCampaign(id);
      await refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to pause campaign'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async (id: string) => {
    setActionLoading(`resume:${id}`);
    try {
      await advertiserApi.resumeCampaign(id);
      await refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to resume campaign'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (campaign: Campaign) => {
    const unspentMinor = Math.max(0, campaign.budgetTotalMinor - campaign.budgetSpentMinor);
    const refundText =
      unspentMinor > 0
        ? ` This records ${formatCurrency(
            unspentMinor,
            campaign.currency,
          )} of unspent budget as a pending refund obligation for admin reconciliation.`
        : '';

    if (
      !window.confirm(
        `Archive "${campaign.name}"? This permanently stops the campaign.${refundText}`,
      )
    ) {
      return;
    }

    setActionLoading(`archive:${campaign.id}`);
    try {
      await advertiserApi.archiveCampaign(campaign.id);
      await refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to archive campaign'));
    } finally {
      setActionLoading(null);
    }
  };

  const totalBudgetByCurrency =
    data?.campaigns.reduce<Record<string, number>>((totals, campaign) => {
      totals[campaign.currency] = (totals[campaign.currency] ?? 0) + campaign.budgetTotalMinor;
      return totals;
    }, {}) || {};
  const totalSpentByCurrency =
    data?.campaigns.reduce<Record<string, number>>((totals, campaign) => {
      totals[campaign.currency] = (totals[campaign.currency] ?? 0) + campaign.budgetSpentMinor;
      return totals;
    }, {}) || {};
  const campaignCurrencies = Object.keys(totalBudgetByCurrency);
  const singleCurrency = campaignCurrencies.length === 1 ? campaignCurrencies[0] : null;
  const totalBudget = singleCurrency ? totalBudgetByCurrency[singleCurrency] : 0;
  const totalSpent = singleCurrency ? (totalSpentByCurrency[singleCurrency] ?? 0) : 0;

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
            <StatCard label="Total campaigns" value={data.total.toString()} />
            <StatCard label="Total budget" value={formatCurrencyBreakdown(totalBudgetByCurrency)} />
            <StatCard
              label="Budget spent"
              value={formatCurrencyBreakdown(totalSpentByCurrency)}
              valueColor="text-brand-500"
              subtitle={
                singleCurrency && totalBudget > 0
                  ? `${((totalSpent / totalBudget) * 100).toFixed(1)}% used`
                  : undefined
              }
            />
          </div>

          {/* Filter */}
          <div className="mb-6 flex items-center gap-2">
            <span className="text-ink-400 text-sm">Status:</span>
            {['', 'draft', 'submitted', 'approved', 'active', 'paused', 'rejected', 'archived'].map(
              (status) => (
                <button
                  key={status || 'all'}
                  onClick={() => {
                    setStatusFilter(status);
                    setPage(1);
                  }}
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
                  {(() => {
                    const rejectionMessage = getCampaignRejectionMessage(campaign);
                    return rejectionMessage ? (
                      <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <p className="text-red-300 text-xs">Rejected: {rejectionMessage}</p>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <StatusBadge status={campaign.status} />
                      <h3 className="text-white font-medium">{campaign.name}</h3>
                      <span className="text-ink-500 text-xs uppercase">{campaign.bidType}</span>
                      {campaign.status === 'approved' && !hasApprovedCreative(campaign) && (
                        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] px-2 py-0.5 rounded-md font-medium">
                          Needs Approved Creative
                        </span>
                      )}
                      {campaign.status === 'approved' &&
                        hasApprovedCreative(campaign) &&
                        campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] px-2 py-0.5 rounded-md font-medium">
                            Insufficient Budget
                          </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                      {(() => {
                        const actions = getCampaignActions(campaign);
                        return (
                          <>
                            {actions.canEdit && (
                              <Link
                                href={`/advertiser/campaigns/${campaign.id}/edit`}
                                className="text-brand-500 hover:text-brand-400 text-xs font-medium"
                              >
                                Edit
                              </Link>
                            )}
                            {actions.canPause && (
                              <button
                                onClick={() => handlePause(campaign.id)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="text-amber-400 hover:text-amber-300 text-xs font-medium disabled:opacity-50"
                              >
                                {isActionLoading('pause', campaign.id) ? 'Pausing...' : 'Pause'}
                              </button>
                            )}
                            {actions.canResume && (
                              <button
                                onClick={() => handleResume(campaign.id)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="text-emerald-400 hover:text-emerald-300 text-xs font-medium disabled:opacity-50"
                              >
                                {isActionLoading('resume', campaign.id) ? 'Resuming...' : 'Resume'}
                              </button>
                            )}
                            {actions.canArchive && (
                              <button
                                onClick={() => handleArchive(campaign)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="text-red-400 hover:text-red-300 text-xs font-medium disabled:opacity-50"
                              >
                                {isActionLoading('archive', campaign.id)
                                  ? 'Archiving...'
                                  : 'Archive'}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-ink-500 text-xs">Budget</p>
                      <p className="text-white font-mono">
                        {formatCurrency(campaign.budgetSpentMinor, campaign.currency)} /{' '}
                        {formatCurrency(campaign.budgetTotalMinor, campaign.currency)}
                      </p>
                      <div className="h-1.5 bg-ink-700 rounded-full mt-1.5 overflow-hidden">
                        <div
                          className="h-full bg-brand-500 transition-all"
                          style={{
                            width:
                              campaign.budgetTotalMinor > 0
                                ? `${(campaign.budgetSpentMinor / campaign.budgetTotalMinor) * 100}%`
                                : '0%',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-ink-500 text-xs">Impressions</p>
                      <p className="text-white font-mono">
                        {campaign.impressions.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-500 text-xs">Clicks</p>
                      <p className="text-white font-mono">{campaign.clicks.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-ink-500 text-xs">Created</p>
                      <p className="text-ink-300 text-xs">
                        {formatRelativeTime(campaign.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Pagination (A-074) */}
          {data.total > limit && (
            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-4 py-2 rounded-lg text-sm bg-ink-700 text-ink-200 hover:bg-ink-600 disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <span className="text-ink-400 text-sm">
                Page {page} of {Math.max(1, Math.ceil(data.total / limit))}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(data.total / limit)}
                className="px-4 py-2 rounded-lg text-sm bg-ink-700 text-ink-200 hover:bg-ink-600 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
