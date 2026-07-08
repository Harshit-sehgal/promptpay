'use client';

import { useEffect, useState } from 'react';
import { referralApi } from '@/lib/api/services';
import { getErrorMessage } from '@/lib/api/errors';
import { LoadingSpinner, StatusBadge } from '@/components';
import { formatCurrencyBreakdown, formatDate } from '@/lib/format';

interface ReferralData {
  referralCode: string | null;
  referralCount: number;
  referralLink: string | null;
  rewardsEarnedMinor: number;
  rewardsEarnedByCurrency?: Record<string, number>;
  referrals: ReferralInfo[];
}

interface ReferralInfo {
  id: string;
  referredEmail: string;
  referredName: string | null;
  status: string;
  createdAt: string;
  rewards: { amountMinor: number; currency: string; status: string }[];
}

export default function ReferralPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    referralApi.getInfo()
      .then((res) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load referral data')))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    if (data?.referralLink) {
      navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Referrals</h1>
        <p className="text-surface-500 text-[15px] font-normal">Invite developers and earn rewards when they get their first payout</p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm font-normal">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Referral stats grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white border border-surface-200/80 rounded-2xl p-6 shadow-sm">
              <p className="text-surface-500 text-sm mb-1.5 font-medium">Your referral code</p>
              {data.referralCode ? (
                <p className="text-2xl font-mono font-semibold text-brand-500 tracking-widest">{data.referralCode}</p>
              ) : (
                <p className="text-surface-400 text-sm font-normal">No code generated yet</p>
              )}
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-6 shadow-sm">
              <p className="text-surface-500 text-sm mb-1.5 font-medium">Total referrals</p>
              <p className="text-3xl font-semibold text-surface-900">{data.referralCount}</p>
            </div>
            <div className="bg-white border border-surface-200/80 rounded-2xl p-6 shadow-sm">
              <p className="text-surface-500 text-sm mb-1.5 font-medium">Rewards earned</p>
              <p className="text-3xl font-semibold text-emerald-600 font-mono">
                {formatCurrencyBreakdown(data.rewardsEarnedByCurrency ?? { USD: data.rewardsEarnedMinor })}
              </p>
            </div>
          </div>

          {/* Referral link + copy (No nested border boxes) */}
          {data.referralLink && (
            <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm mb-8">
              <h2 className="text-surface-900 font-bold text-[16px] mb-4">Your referral link</h2>
              <div className="flex items-center gap-3">
                <code className="flex-1 bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-700 text-[14px] break-all font-mono">
                  {data.referralLink}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-5 py-3 bg-brand-500 hover:bg-brand-600 text-white text-[14px] font-medium rounded-xl shadow-sm shadow-brand-500/10 transition-colors shrink-0"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="text-surface-500 text-[13px] mt-3 font-normal leading-relaxed">
                Share this link — when someone signs up and gets their first payout ($10+), you earn <span className="text-emerald-600 font-medium">$5</span>.
              </p>
            </div>
          )}

          {/* Referral history */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm overflow-hidden">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Referral history</h2>
            {data.referrals.length === 0 ? (
              <p className="text-surface-400 text-sm py-8 text-center font-normal">No referrals yet. Share your link to start earning.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-50/50 border-b border-surface-200/80 text-surface-500 font-medium">
                      <th className="text-left px-5 py-3.5 font-medium">Referred user</th>
                      <th className="text-left px-5 py-3.5 font-medium">Status</th>
                      <th className="text-left px-5 py-3.5 font-medium">Date</th>
                      <th className="text-right px-5 py-3.5 font-medium">Reward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {data.referrals.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-50/30 transition-colors">
                        <td className="px-5 py-3.5 font-normal text-surface-900">
                          <p className="font-medium text-surface-900">{r.referredName || r.referredEmail}</p>
                          <p className="text-surface-400 text-xs font-mono mt-0.5">{r.referredEmail}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-5 py-3.5 text-surface-500 font-normal">{formatDate(r.createdAt)}</td>
                        <td className="px-5 py-3.5 text-right text-emerald-600 font-mono font-semibold">
                          {r.rewards.length > 0
                            ? formatCurrencyBreakdown(
                                r.rewards.reduce<Record<string, number>>((totals, reward) => {
                                  totals[reward.currency] = (totals[reward.currency] ?? 0) + reward.amountMinor;
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
          </div>
        </>
      )}
    </div>
  );
}
