'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { referralApi } from '@/lib/api/services';
import { formatCurrencyBreakdown, formatDate } from '@/lib/format';

import { useToast } from '@ateva/ui';

interface ReferralData {
  referralCode: string | null;
  referralCount: number;
  referralLink: string | null;
  rewardsEarnedMinor: bigint;
  rewardsEarnedByCurrency?: Record<string, bigint>;
  referrals: ReferralInfo[];
}

interface ReferralInfo {
  id: string;
  referredEmail: string;
  referredName: string | null;
  status: string;
  createdAt: string;
  rewards: { amountMinor: bigint; currency: string; status: string }[];
}

export default function ReferralPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { info } = useToast();

  useEffect(() => {
    referralApi
      .getInfo()
      .then((res) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load referral data')))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    if (data?.referralLink) {
      navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      info('Referral link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <PageHeader
        title="Referrals"
        lede="Invite developers now; referral rewards begin only after the independently attested earnings launch."
      />

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {data && (
        <>
          {/* Referral stats grid */}
          <div className="dash-grid dash-grid--3">
            <Panel label="Your referral code">
              {data.referralCode ? (
                <Stat label="Your referral code" value={data.referralCode} />
              ) : (
                <>
                  <p className="dash-stat__label">Your referral code</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">No code generated yet</p>
                </>
              )}
            </Panel>
            <Panel label="Total referrals">
              <Stat label="Total referrals" value={data.referralCount} />
            </Panel>
            <Panel label="Rewards earned">
              <Stat
                label="Rewards earned"
                value={formatCurrencyBreakdown(
                  data.rewardsEarnedByCurrency ?? { USD: data.rewardsEarnedMinor },
                )}
              />
            </Panel>
          </div>

          {/* Referral link + copy */}
          {data.referralLink && (
            <Panel label="Your referral link">
              <PanelHeader title="Your referral link" />
              <div className="flex items-center gap-3">
                <code className="min-w-0 flex-1 rounded-xl border border-[var(--hair)] bg-[var(--page)] px-4 py-3 text-sm break-all text-[var(--ink)]">
                  {data.referralLink}
                </code>
                <button onClick={handleCopy} className="dash-btn dash-btn--primary dash-btn--md">
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
                Share this link to grow the beta. After rewards launch, a first qualifying payout (
                {'$10+'}) earns a <span className="font-medium text-[var(--ink)]">$5</span> referral
                reward.
              </p>
            </Panel>
          )}

          {/* Referral history */}
          <Panel label="Referral history" flush>
            <PanelHeader title="Referral history" />
            {data.referrals.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                No referrals yet. Share your link to grow the beta.
              </p>
            ) : (
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Referrals table, scrolls horizontally"
              >
                <table className="min-w-[680px]">
                  <thead>
                    <tr>
                      <th>Referred user</th>
                      <th>Status</th>
                      <th>Date</th>
                      <th className="text-right">Reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrals.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <p className="font-medium text-[var(--ink)]">
                            {r.referredName || r.referredEmail}
                          </p>
                          <p className="dash-mono mt-0.5 text-xs text-[var(--muted)]">
                            {r.referredEmail}
                          </p>
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td>{formatDate(r.createdAt)}</td>
                        <td className="dash-mono text-right text-[var(--ink)]">
                          {r.rewards.length > 0
                            ? formatCurrencyBreakdown(
                                r.rewards.reduce<Record<string, bigint>>((totals, reward) => {
                                  totals[reward.currency] =
                                    (totals[reward.currency] ?? 0n) + reward.amountMinor;
                                  return totals;
                                }, {}),
                              )
                            : '$0.00'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
