'use client';

import type { AxiosResponse } from 'axios';
import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, Stat, type Tone } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
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
    (developerApi.getTrust() as Promise<AxiosResponse<TrustInfo>>)
      .then((res) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load trust info')))
      .finally(() => setLoading(false));
  }, []);

  const bandTone = (band: TrustInfo['band']): Tone => {
    switch (band) {
      case 'excellent':
      case 'high':
        return 'ok';
      case 'medium':
        return 'warn';
      case 'low':
      default:
        return 'bad';
    }
  };

  return (
    <>
      <PageHeader
        title="Trust & fraud"
        lede="How your account is scored for fraud-risk. Higher trust leads to faster payouts."
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

      {!loading && !error && !data && (
        <Panel label="Trust details unavailable">
          <p className="text-center text-sm text-[var(--muted)]">
            Trust details are not available yet.
          </p>
        </Panel>
      )}

      {data && (
        <>
          <div className="dash-grid dash-grid--3">
            <Panel label="Trust score">
              <Stat
                label="Trust score"
                value={`${data.score}/100`}
                detail={
                  <Pill tone={bandTone(data.band)}>{`Band: ${data.band.toUpperCase()}`}</Pill>
                }
              />
            </Panel>
            <Panel label="Open fraud flags">
              <Stat label="Open fraud flags" value={data.openFlags.length.toString()} />
            </Panel>
            <Panel label="Recent penalties">
              <Stat label="Recent penalties" value={data.recentPenalties.length.toString()} />
            </Panel>
          </div>

          {/* Score breakdown */}
          <Panel label="Score breakdown">
            <PanelHeader title="Score breakdown" />
            <div className="space-y-6">
              {data.factors.map((factor) => {
                const pct = (factor.points / factor.maxPoints) * 100;
                return (
                  <div key={factor.key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium text-[var(--ink)]">{factor.label}</span>
                      <span className="dash-mono text-sm text-[var(--ink)]">
                        {factor.points}/{factor.maxPoints}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hair)]">
                      <div
                        className="h-full rounded-full bg-[var(--ink)] transition-all duration-500 motion-reduce:transition-none"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--muted)]">{factor.detail}</p>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Open flags */}
          <Panel label="Open fraud flags list" flush>
            <PanelHeader title="Open fraud flags" />
            {data.openFlags.length === 0 ? (
              <p className="px-[22px] pb-6 pt-2 text-center text-sm text-[var(--muted)]">
                No open flags. Keep your activity clean.
              </p>
            ) : (
              <div className="dash-rows">
                {data.openFlags.map((flag) => (
                  <div key={flag.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">{flag.reason}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Detected {formatRelativeTime(flag.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={flag.severity} />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Recent penalties */}
          <Panel label="Recent penalties list" flush>
            <PanelHeader title="Recent penalties" />
            {data.recentPenalties.length === 0 ? (
              <p className="px-[22px] pb-6 pt-2 text-center text-sm text-[var(--muted)]">
                No penalty history. Stay active and verified to keep your score high.
              </p>
            ) : (
              <div className="dash-rows">
                {data.recentPenalties.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">{p.description}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {formatRelativeTime(p.appliedAt)}
                      </p>
                    </div>
                    <StatusBadge status={p.severity} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
