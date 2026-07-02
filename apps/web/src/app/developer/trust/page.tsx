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
        return 'text-emerald-600';
      case 'high':
        return 'text-brand-600';
      case 'medium':
        return 'text-amber-600';
      case 'low':
      default:
        return 'text-red-600';
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Trust & fraud</h1>
        <p className="text-surface-500 text-[15px]">
          How your account is scored for fraud-risk. Higher trust → higher payouts.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <StatCard
              label="Trust score"
              value={`${data.score}/100`}
              valueColor={bandColor(data.band)}
              subtitle={`Band: ${data.band.toUpperCase()}`}
              variant="light"
            />
            <StatCard
              label="Open fraud flags"
              value={data.openFlags.length.toString()}
              valueColor={data.openFlags.length > 0 ? 'text-red-600' : undefined}
              variant="light"
            />
            <StatCard
              label="Recent penalties"
              value={data.recentPenalties.length.toString()}
              variant="light"
            />
          </div>

          {/* Score breakdown */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm mb-8">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Score breakdown</h2>
            <div className="space-y-6">
              {data.factors.map((factor) => {
                const pct = (factor.points / factor.maxPoints) * 100;
                return (
                  <div key={factor.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-surface-800 font-medium text-sm">{factor.label}</span>
                      <span className="text-surface-900 font-bold font-mono text-sm">
                        {factor.points}/{factor.maxPoints}
                      </span>
                    </div>
                    <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-surface-400 text-xs mt-1.5">{factor.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Open flags */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm mb-8">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Open fraud flags</h2>
            {data.openFlags.length === 0 ? (
              <p className="text-surface-400 text-sm py-4 text-center">
                No open flags. Keep your activity clean.
              </p>
            ) : (
              <div className="space-y-3">
                {data.openFlags.map((flag) => (
                  <div
                    key={flag.id}
                    className="flex items-center justify-between bg-surface-50/50 border border-surface-200/60 rounded-xl p-4.5 border-l-4 border-l-amber-500"
                  >
                    <div>
                      <p className="text-surface-900 font-semibold text-[14px]">{flag.reason}</p>
                      <p className="text-surface-500 text-xs mt-0.5">
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
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Recent penalties</h2>
            {data.recentPenalties.length === 0 ? (
              <p className="text-surface-400 text-sm py-4 text-center">
                No penalty history. Stay active and verified to keep your score high.
              </p>
            ) : (
              <div className="space-y-3">
                {data.recentPenalties.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-surface-50/50 border border-surface-200/60 rounded-xl p-4.5">
                    <div>
                      <p className="text-surface-900 font-semibold text-[14px]">{p.description}</p>
                      <p className="text-surface-500 text-xs mt-0.5">
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
    </div>
  );
}
