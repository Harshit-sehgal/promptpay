'use client';

import { useEffect, useState } from 'react';
import { referralApi } from '@/lib/api/services';
import { LoadingSpinner } from '@/components';
import { formatCurrency, formatDate } from '@/lib/format';

interface ReferralData {
  referralCode: string | null;
  referralCount: number;
  referralLink: string | null;
  rewardsEarnedMinor: number;
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
      .catch((err) => setError(err.response?.data?.message || 'Failed to load referral data'))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    if (data?.referralLink) {
      navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'rewarded': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'pending': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'bg-ink-700 text-ink-300 border-ink-600/20';
    }
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Referrals</h1>
        <p className="text-ink-300 text-sm">Invite developers and earn rewards when they get their first payout</p>
      </div>

      {loading && <LoadingSpinner />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Referral stats grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Your referral code</p>
              {data.referralCode ? (
                <p className="text-2xl font-mono font-bold text-brand-500 tracking-widest">{data.referralCode}</p>
              ) : (
                <p className="text-ink-400 text-sm">No code generated yet</p>
              )}
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Total referrals</p>
              <p className="text-3xl font-bold text-white">{data.referralCount}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Rewards earned</p>
              <p className="text-3xl font-bold text-emerald-400">{formatCurrency(data.rewardsEarnedMinor)}</p>
            </div>
          </div>

          {/* Referral link + copy */}
          {data.referralLink && (
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <h2 className="text-white font-semibold mb-3">Your referral link</h2>
              <div className="flex items-center gap-3">
                <code className="flex-1 bg-ink-900 border border-ink-600/30 rounded-lg px-4 py-2 text-ink-200 text-sm break-all">
                  {data.referralLink}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-ink-400 text-xs mt-2">
                Share this link — when someone signs up and gets their first payout ($10+), you earn $5.
              </p>
            </div>
          )}

          {/* Referral history */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Referral history</h2>
            {data.referrals.length === 0 ? (
              <p className="text-ink-400 text-sm">No referrals yet. Share your link to start earning.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-ink-300 border-b border-ink-600/30">
                      <th className="text-left py-3 pr-4">Referred user</th>
                      <th className="text-left py-3 pr-4">Status</th>
                      <th className="text-left py-3 pr-4">Date</th>
                      <th className="text-right py-3">Reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrals.map((r) => (
                      <tr key={r.id} className="border-b border-ink-600/10 last:border-0">
                        <td className="py-3 pr-4">
                          <p className="text-white">{r.referredName || r.referredEmail}</p>
                          <p className="text-ink-400 text-xs">{r.referredEmail}</p>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-ink-300">{formatDate(r.createdAt)}</td>
                        <td className="py-3 text-right text-emerald-400">
                          {r.rewards.length > 0
                            ? formatCurrency(r.rewards.reduce((s, rw) => s + rw.amountMinor, 0))
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
    </>
  );
}