'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { ActionLink, Notice, PageHeader, Panel, Pill, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import {
  bigintRatioPercent,
  formatCurrency,
  formatCurrencyBreakdown,
  formatRelativeTime,
} from '@/lib/format';

import {
  clampCampaignPage,
  getCampaignActions,
  getCampaignRejectionMessage,
} from './campaign-actions';

interface CreativeSummary {
  status: string;
  rejectionReason?: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  bidType: string;
  bidAmountMinor: bigint;
  budgetTotalMinor: bigint;
  budgetSpentMinor: bigint;
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
      const total = res.data.total ?? 0;
      setData({ campaigns: res.data.campaigns || [], total });
      const validPage = clampCampaignPage(page, total, limit);
      if (validPage !== page) setPage(validPage);
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
    if (
      !window.confirm(
        `Archive "${campaign.name}"? This permanently stops the campaign. Unspent funds remain in your advertiser balance.`,
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
    data?.campaigns.reduce<Record<string, bigint>>((totals, campaign) => {
      totals[campaign.currency] = (totals[campaign.currency] ?? 0n) + campaign.budgetTotalMinor;
      return totals;
    }, {}) || {};
  const totalSpentByCurrency =
    data?.campaigns.reduce<Record<string, bigint>>((totals, campaign) => {
      totals[campaign.currency] = (totals[campaign.currency] ?? 0n) + campaign.budgetSpentMinor;
      return totals;
    }, {}) || {};
  const campaignCurrencies = Object.keys(totalBudgetByCurrency);
  const singleCurrency = campaignCurrencies.length === 1 ? campaignCurrencies[0] : null;
  const totalBudget = singleCurrency ? totalBudgetByCurrency[singleCurrency] : 0n;
  const totalSpent = singleCurrency ? (totalSpentByCurrency[singleCurrency] ?? 0n) : 0n;

  return (
    <>
      <PageHeader
        eyebrow="Advertiser"
        title="Campaigns"
        lede="Manage and review your ad campaigns"
        actions={
          <ActionLink href="/advertiser/campaigns/new" variant="primary">
            + New campaign
          </ActionLink>
        }
      />

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {data && (
        <>
          <div className="dash-grid dash-grid--3">
            <Panel label="Total campaigns">
              <Stat label="Total campaigns" value={data.total.toString()} />
            </Panel>
            <Panel label="Total budget">
              <Stat label="Total budget" value={formatCurrencyBreakdown(totalBudgetByCurrency)} />
            </Panel>
            <Panel label="Budget spent">
              <Stat
                label="Budget spent"
                value={formatCurrencyBreakdown(totalSpentByCurrency)}
                detail={
                  singleCurrency && totalBudget > 0n
                    ? `${bigintRatioPercent(totalSpent, totalBudget, 1).toFixed(1)}% used`
                    : undefined
                }
              />
            </Panel>
          </div>

          {/* Filter */}
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filter campaigns by status"
          >
            <span className="text-sm text-[var(--muted)]">Status:</span>
            {['', 'draft', 'submitted', 'approved', 'active', 'paused', 'rejected', 'archived'].map(
              (status) => (
                <button
                  type="button"
                  key={status || 'all'}
                  onClick={() => {
                    setStatusFilter(status);
                    setPage(1);
                  }}
                  aria-pressed={statusFilter === status}
                  className={`dash-btn dash-btn--sm ${
                    statusFilter === status ? 'dash-btn--primary' : 'dash-btn--glass'
                  }`}
                >
                  {status || 'All'}
                </button>
              ),
            )}
          </div>

          {/* Campaign list */}
          {data.campaigns.length === 0 ? (
            <Panel className="text-center">
              <p className="mb-4 text-sm text-[var(--muted)]">No campaigns found.</p>
              <ActionLink href="/advertiser/campaigns/new" variant="primary">
                Create your first campaign
              </ActionLink>
            </Panel>
          ) : (
            <div className="grid gap-4">
              {data.campaigns.map((campaign) => (
                <Panel key={campaign.id}>
                  {(() => {
                    const rejectionMessage = getCampaignRejectionMessage(campaign);
                    return rejectionMessage ? (
                      <div className="mb-4">
                        <Notice tone="bad">Rejected: {rejectionMessage}</Notice>
                      </div>
                    ) : null;
                  })()}
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={campaign.status} />
                      <h3 className="font-medium text-[var(--ink)]">{campaign.name}</h3>
                      <span className="dash-mono text-xs text-[var(--muted)] uppercase">
                        {campaign.bidType}
                      </span>
                      {campaign.status === 'approved' && !hasApprovedCreative(campaign) && (
                        <Pill tone="warn">Needs Approved Creative</Pill>
                      )}
                      {campaign.status === 'approved' &&
                        hasApprovedCreative(campaign) &&
                        campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                          <Pill tone="warn">Insufficient Budget</Pill>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const actions = getCampaignActions(campaign);
                        return (
                          <>
                            {actions.canEdit && (
                              <ActionLink
                                href={`/advertiser/campaigns/${campaign.id}/edit`}
                                variant="text"
                              >
                                Edit
                              </ActionLink>
                            )}
                            {actions.canPause && (
                              <button
                                onClick={() => handlePause(campaign.id)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="dash-btn dash-btn--glass dash-btn--sm"
                              >
                                {isActionLoading('pause', campaign.id) ? 'Pausing...' : 'Pause'}
                              </button>
                            )}
                            {actions.canResume && (
                              <button
                                onClick={() => handleResume(campaign.id)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="dash-btn dash-btn--glass dash-btn--sm"
                              >
                                {isActionLoading('resume', campaign.id) ? 'Resuming...' : 'Resume'}
                              </button>
                            )}
                            {actions.canArchive && (
                              <button
                                onClick={() => handleArchive(campaign)}
                                disabled={isCampaignBusy(campaign.id)}
                                className="dash-btn dash-btn--danger dash-btn--sm"
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

                  <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                    <div>
                      <p className="text-xs text-[var(--muted)]">Budget</p>
                      <p className="dash-mono text-[var(--ink)]">
                        {formatCurrency(campaign.budgetSpentMinor, campaign.currency)} /{' '}
                        {formatCurrency(campaign.budgetTotalMinor, campaign.currency)}
                      </p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--hair)]">
                        <div
                          className="h-full bg-[var(--ink)] transition-all"
                          style={{
                            width:
                              campaign.budgetTotalMinor > 0n
                                ? `${Math.min(
                                    100,
                                    bigintRatioPercent(
                                      campaign.budgetSpentMinor,
                                      campaign.budgetTotalMinor,
                                      2,
                                    ),
                                  )}%`
                                : '0%',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Impressions</p>
                      <p className="dash-mono text-[var(--ink)]">
                        {campaign.impressions.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Clicks</p>
                      <p className="dash-mono text-[var(--ink)]">
                        {campaign.clicks.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Created</p>
                      <p className="text-xs text-[var(--copy)]">
                        {formatRelativeTime(campaign.createdAt)}
                      </p>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
          {/* Pagination (A-074) */}
          {data.total > limit && (
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="dash-btn dash-btn--glass dash-btn--md"
              >
                Previous
              </button>
              <span className="text-sm text-[var(--copy)]">
                Page {page} of {Math.max(1, Math.ceil(data.total / limit))}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(data.total / limit)}
                className="dash-btn dash-btn--glass dash-btn--md"
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
