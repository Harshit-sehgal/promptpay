'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { ActionLink, Notice, PageHeader, Panel, PanelHeader, Pill, Stat } from '@/components/dash';
import SandboxDepositPanel from '@/components/sandbox-deposit-panel';
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
  bidAmountMinor: bigint;
  budgetTotalMinor: bigint;
  budgetSpentMinor: bigint;
  currency: string;
  createdAt: string;
  creatives?: CreativeSummary[];
}

interface AdvertiserData {
  totalSpendMinor: bigint;
  totalSpendByCurrency?: Record<string, bigint>;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  activeCampaigns: number;
  totalCampaigns: number;
  campaigns: DashboardCampaign[];
}

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

  // Handle hosted-checkout redirect (successUrl/cancelUrl in advertiser.controller.ts)
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
      <PageHeader title="Advertiser overview" />

      {/* Hosted-checkout redirect banners */}
      {banner?.visible && (
        <Notice
          tone={banner.type === 'success' ? 'ok' : 'warn'}
          actions={
            <>
              {banner.type === 'success' && (
                <ActionLink href="/advertiser/billing" variant="text">
                  View billing
                </ActionLink>
              )}
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="dash-btn dash-btn--ghost dash-btn--sm"
                aria-label="Dismiss"
              >
                Dismiss
              </button>
            </>
          }
        >
          {banner.type === 'success'
            ? 'Your payment was completed. Your account balance will be credited once the payment is confirmed by our payment processor. Check the billing page in a moment.'
            : 'Deposit cancelled. No charges were made.'}
        </Notice>
      )}

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
              onClick={loadDashboard}
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
          <SandboxDepositPanel />

          <div className="dash-grid dash-grid--4">
            <Panel label="Total spend">
              <Stat
                label="Total spend"
                value={formatCurrencyBreakdown(
                  data.totalSpendByCurrency ?? { USD: data.totalSpendMinor },
                )}
                detail="Across all campaigns"
                chip
              />
            </Panel>
            <Panel label="Impressions">
              <Stat
                label="Impressions"
                value={formatNumber(data.totalImpressions)}
                detail="Ad views delivered"
              />
            </Panel>
            <Panel label="Clicks">
              <Stat
                label="Clicks"
                value={formatNumber(data.totalClicks)}
                detail="Qualified clicks"
              />
            </Panel>
            <Panel label="CTR">
              <Stat
                label="CTR"
                value={formatPercent(data.ctr * 100, 2)}
                detail="Click-through rate"
              />
            </Panel>
          </div>

          <Panel label="Campaigns" flush>
            <PanelHeader
              title={`Campaigns (${data.totalCampaigns})`}
              action={
                <ActionLink href="/advertiser/campaigns/new" variant="primary">
                  Create campaign
                </ActionLink>
              }
            />
            {data.campaigns.length > 0 ? (
              <div className="dash-rows">
                {data.campaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={campaign.status} />
                      <p className="font-medium text-[var(--ink)]">{campaign.name}</p>
                      {campaign.status === 'approved' && !hasApprovedCreative(campaign) && (
                        <Pill tone="warn">Needs Approved Creative</Pill>
                      )}
                      {campaign.status === 'approved' &&
                        hasApprovedCreative(campaign) &&
                        campaign.budgetSpentMinor >= campaign.budgetTotalMinor && (
                          <Pill tone="warn">Insufficient Budget</Pill>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--copy)] sm:gap-6">
                      <span className="dash-mono">
                        Budget: {formatCurrency(campaign.budgetSpentMinor, campaign.currency)} /{' '}
                        {formatCurrency(campaign.budgetTotalMinor, campaign.currency)}
                      </span>
                      <span className="uppercase">{campaign.bidType}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center px-[22px] py-12 text-center">
                <p className="text-sm font-medium text-[var(--ink)]">No campaigns yet</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Create your first campaign to start reaching developers.
                </p>
                <div className="mt-4">
                  <ActionLink href="/advertiser/campaigns/new" variant="primary">
                    Create campaign
                  </ActionLink>
                </div>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Invalid traffic protection" />
            <p className="text-sm text-[var(--copy)]">
              All impressions require a 5-second minimum visible duration, validated device
              fingerprint, and cleared fraud checks. Suspicious traffic is automatically flagged and
              excluded from billing.
            </p>
          </Panel>
        </>
      )}
    </>
  );
}
