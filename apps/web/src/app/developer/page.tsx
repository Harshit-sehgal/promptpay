'use client';

import { useEffect, useState } from 'react';
import { developerApi } from '@/lib/api/services';
import { LoadingSpinner } from '@/components';
import { formatCurrency } from '@/lib/format';

interface DashboardData {
  estimatedEarnings: number;
  confirmedEarnings: number;
  pendingEarnings: number;
  heldEarnings: number;
  availableForPayout: number;
  lifetimeEarnings: number;
  trustLevel: string;
  trustScore: number;
  payoutHoldStatus: {
    isHeld: boolean;
    reason?: string;
  };
  settings: {
    adsEnabled: boolean;
    quietMode: boolean;
    maxAdsPerHour: number;
  };
}

export default function DeveloperDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    developerApi.getDashboard()
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  const trustLabel = (level: string) => {
    switch (level) {
      case 'high_trust': return { text: 'High Trust', color: 'text-emerald-400' };
      case 'normal': return { text: 'Normal', color: 'text-blue-400' };
      case 'low_trust': return { text: 'Low Trust', color: 'text-amber-400' };
      default: return { text: 'New', color: 'text-amber-400' };
    }
  };

  const trust = data ? trustLabel(data.trustLevel) : trustLabel('new');

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
        <p className="text-ink-300 text-sm">Your earnings overview and account status</p>
      </div>

      {loading && <LoadingSpinner />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Today's estimated earnings</p>
              <p className="text-3xl font-bold text-white">{formatCurrency(data.estimatedEarnings)}</p>
              <p className="text-ink-400 text-xs mt-1">Updated in real time</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Available for payout</p>
              <p className="text-3xl font-bold text-brand-500">{formatCurrency(data.availableForPayout)}</p>
              <p className="text-ink-400 text-xs mt-1">Minimum: $10.00</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <p className="text-ink-300 text-sm mb-1">Trust level</p>
              <p className={`text-3xl font-bold ${trust.color}`}>{trust.text}</p>
              <p className="text-ink-400 text-xs mt-1">Score: {data.trustScore}/100</p>
            </div>
          </div>

          {/* Earnings breakdown */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <h2 className="text-white font-semibold mb-4">Earnings breakdown</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Estimated</p>
                <p className="text-white font-mono text-lg">{formatCurrency(data.estimatedEarnings)}</p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Pending</p>
                <p className="text-white font-mono text-lg">{formatCurrency(data.pendingEarnings)}</p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Confirmed</p>
                <p className="text-white font-mono text-lg">{formatCurrency(data.confirmedEarnings)}</p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Held</p>
                <p className="text-white font-mono text-lg">{formatCurrency(data.heldEarnings)}</p>
              </div>
              <div>
                <p className="text-ink-400 text-xs uppercase tracking-wider">Lifetime</p>
                <p className="text-white font-mono text-lg">{formatCurrency(data.lifetimeEarnings)}</p>
              </div>
            </div>
          </div>

          {/* Payout hold status */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Payout hold status</h2>
            {data.payoutHoldStatus.isHeld ? (
              <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <p className="text-amber-400 text-sm">
                  {data.payoutHoldStatus.reason || 'New accounts have a 30-day payout hold. Verify your email and GitHub to speed this up.'}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <p className="text-emerald-400 text-sm">
                  Your account is in good standing — no payout hold active.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
