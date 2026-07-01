'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard, StatusBadge } from '@/components';
import { developerApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

interface TrustFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

interface TrustInfo {
  score: number;
  band: 'low' | 'medium' | 'high' | 'excellent';
  factors: TrustFactor[];
  openFlags: Array<{
    id: string;
    severity: string;
    reason: string;
    createdAt: string;
  }>;
  recentPenalties: Array<{
    id: string;
    severity: string;
    type: string;
    description: string;
    appliedAt: string;
  }>;
}

export default function DevTrustPage() {
  const [data, setData] = useState<TrustInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    developerApi.getSettings()
      .then((res: any) => setData(res.data.trust))
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load trust info'))
      .finally(() => setLoading(false));
  }, []);

  const bandColor = (band: TrustInfo['band']) => {
    switch (band) {
      case 'excellent':
        return 'text-emerald-400';
      case 'high':
        return 'text-brand-500';
      case 'medium':
        return 'text-amber-400';
      case 'low':
      default:
        return 'text-red-400';
    }
  };

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Trust & fraud</h1>
          <p className="text-ink-300 text-sm">
            How your account is scored for fraud-risk. Higher trust → higher payouts.
          </p>
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
              <StatCard
                label="Trust score"
                value={`${data.score}/100`}
                valueColor={bandColor(data.band)}
                subtitle={`Band: ${data.band}`}
              />
              <StatCard
                label="Open fraud flags"
                value={data.openFlags.length.toString()}
                valueColor={data.openFlags.length > 0 ? 'text-red-400' : undefined}
              />
              <StatCard
                label="Recent penalties"
                value={data.recentPenalties.length.toString()}
              />
            </div>

            {/* Score breakdown */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <h2 className="text-white font-semibold mb-4">Score breakdown</h2>
              <div className="space-y-4">
                {data.factors.map((factor) => {
                  const pct = (factor.points / factor.maxPoints) * 100;
                  return (
                    <div key={factor.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-ink-200 text-sm">{factor.label}</span>
                        <span className="text-white text-sm font-mono">
                          {factor.points}/{factor.maxPoints}
                        </span>
                      </div>
                      <div className="h-2 bg-ink-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-ink-500 text-xs mt-1">{factor.detail}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Open flags */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <h2 className="text-white font-semibold mb-4">Open fraud flags</h2>
              {data.openFlags.length === 0 ? (
                <p className="text-ink-400 text-sm py-4 text-center">
                  No open flags. Keep your activity clean.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.openFlags.map((flag) => (
                    <div
                      key={flag.id}
                      className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4 border-l-4 border-amber-500"
                    >
                      <div>
                        <p className="text-white text-sm">{flag.reason}</p>
                        <p className="text-ink-400 text-xs mt-0.5">
                          Detected {formatRelativeTime(flag.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={flag.severity} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent penalties */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <h2 className="text-white font-semibold mb-4">Recent penalties</h2>
              {data.recentPenalties.length === 0 ? (
                <p className="text-ink-400 text-sm py-4 text-center">
                  No penalty history. Stay active and verified to keep your score high.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.recentPenalties.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                      <div>
                        <p className="text-white text-sm">{p.description}</p>
                        <p className="text-ink-400 text-xs mt-0.5">
                          {formatRelativeTime(p.appliedAt)}
                        </p>
                      </div>
                      <StatusBadge status={p.severity} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      
</>
);

}
