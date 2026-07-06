'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

interface FraudFlag {
  id: string;
  userId: string;
  userEmail?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  flagType: string;
  reason: string;
  evidence?: Record<string, unknown>;
  status: 'open' | 'resolved_valid' | 'resolved_invalid';
  createdAt: string;
}

type FraudFlagsResponse = FraudFlag[] | { flags?: FraudFlag[] };

function normalizeFraudFlags(data: FraudFlagsResponse): FraudFlag[] {
  return Array.isArray(data) ? data : data.flags || [];
}

export default function AdminFraudPage() {
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchFlags = useCallback(() => {
    setLoading(true);
    adminApi.getFraudFlags(severityFilter ? { severity: severityFilter } : undefined)
      .then((res: { data: FraudFlagsResponse }) => setFlags(normalizeFraudFlags(res.data)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load fraud flags')))
      .finally(() => setLoading(false));
  }, [severityFilter]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const handleResolve = async (id: string, decision: 'confirmed' | 'invalid') => {
    setResolving(id);
    try {
      await adminApi.resolveFraudFlag(id, decision, decision === 'confirmed' ? 'Confirmed via admin review' : 'False positive');
      fetchFlags();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Resolve failed'));
    } finally {
      setResolving(null);
    }
  };

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Fraud review</h1>
          <p className="text-ink-300 text-sm">Investigate flagged activity and resolution outcomes</p>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <span className="text-ink-400 text-sm">Severity:</span>
          {['', 'low', 'medium', 'high', 'critical'].map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                severityFilter === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {flags.length === 0 && !loading ? (
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
            <p className="text-ink-400 text-sm">No fraud flags at this severity. Clean queue.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {flags.map((flag) => (
              <div
                key={flag.id}
                className={`bg-ink-800 border rounded-xl p-5 ${
                  flag.severity === 'critical'
                    ? 'border-red-500/50'
                    : flag.severity === 'high'
                    ? 'border-amber-500/40'
                    : 'border-ink-600/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={flag.severity} />
                    <span className="text-ink-300 text-xs capitalize">{flag.flagType.replace('_', ' ')}</span>
                    {flag.status !== 'open' && (
                      <span className="text-ink-500 text-xs capitalize">{flag.status.replace('_', ' ')}</span>
                    )}
                  </div>
                  {flag.status === 'open' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleResolve(flag.id, 'invalid')}
                        disabled={resolving === flag.id}
                        className="bg-ink-700 hover:bg-ink-600 text-emerald-400 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        Mark invalid
                      </button>
                      <button
                        onClick={() => handleResolve(flag.id, 'confirmed')}
                        disabled={resolving === flag.id}
                        className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        Confirm fraud
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-white text-sm mb-2">{flag.reason}</p>

                {flag.evidence && Object.keys(flag.evidence).length > 0 && (
                  <details className="mb-2">
                    <summary className="text-ink-500 text-xs cursor-pointer hover:text-ink-300">
                      View evidence
                    </summary>
                    <pre className="bg-ink-700/50 rounded p-3 mt-2 text-xs text-ink-300 overflow-x-auto">
                      {JSON.stringify(flag.evidence, null, 2)}
                    </pre>
                  </details>
                )}

                <p className="text-ink-500 text-xs">
                  User: <a href={`/admin/users?search=${encodeURIComponent(flag.userId)}`} className="text-brand-400 hover:text-brand-300 underline">{flag.userEmail || flag.userId}</a>
                  <span className="mx-2">·</span>
                  Detected {formatRelativeTime(flag.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      
</>
);
}
