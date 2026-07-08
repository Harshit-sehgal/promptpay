'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatNumber,formatRelativeTime } from '@/lib/format';

// ── Types ──

interface FraudUser {
  id: string;
  email: string | null;
  name: string | null;
  trustLevel: string | null;
}

interface FraudFlag {
  id: string;
  userId: string;
  user?: FraudUser | null;
  userEmail?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  flagType: string;
  reason: string;
  evidence?: Record<string, unknown>;
  status: 'open' | 'reviewing' | 'resolved_valid' | 'resolved_invalid' | 'escalated';
  reviewerId?: string;
  reviewNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface FraudFlagsResponse {
  flags: FraudFlag[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface FraudStats {
  byStatus: {
    open: number;
    reviewing: number;
    resolvedValid: number;
    resolvedInvalid: number;
    escalated: number;
  };
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  byFlagType: { type: string; count: number }[];
  total: number;
  resolvedLast7d: number;
  escalationRate: number;
  avgResolutionMinutes: number;
}

// ── Constants ──

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500' },
  high: { label: 'High', color: 'bg-amber-500' },
  medium: { label: 'Medium', color: 'bg-yellow-500' },
  low: { label: 'Low', color: 'bg-blue-500' },
};

const FLAG_TYPES = [
  'impression_rate_limit',
  'click_rate_limit',
  'duplicate_device',
  'suspicious_ctr',
  'impossible_volume',
  'shared_payout_destination',
  'vpn_proxy_pattern',
  'emulator_vm_pattern',
  'rapid_earning_spike',
  'country_device_change',
  'repeated_click_abuse',
  'self_clicking',
  'automated_pattern',
  'duplicate_account',
] as const;

function flagTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

function severityColor(s: string): string {
  switch (s) {
    case 'critical': return 'border-red-500/50 bg-red-500/5';
    case 'high': return 'border-amber-500/40 bg-amber-500/5';
    case 'medium': return 'border-yellow-500/30 bg-yellow-500/5';
    default: return 'border-ink-600/30';
  }
}

function severityDot(s: string): string {
  switch (s) {
    case 'critical': return 'bg-red-500';
    case 'high': return 'bg-amber-500';
    case 'medium': return 'bg-yellow-500';
    case 'low': return 'bg-blue-500';
    default: return 'bg-ink-500';
  }
}

function trustLevelColor(level: string | null): string {
  switch (level) {
    case 'high_trust': return 'text-emerald-400';
    case 'normal': return 'text-blue-400';
    case 'low_trust': return 'text-amber-400';
    case 'new': return 'text-ink-400';
    case 'restricted': return 'text-red-400';
    case 'banned': return 'text-red-600';
    default: return 'text-ink-400';
  }
}

// ── Component ──

export default function AdminFraudPage() {
  // Data state
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [stats, setStats] = useState<FraudStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [flagTypeFilter, setFlagTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Actions
  const [resolving, setResolving] = useState<string | null>(null);
  const [recomputeUserId, setRecomputeUserId] = useState<string | null>(null);
  const [expandedFlag, setExpandedFlag] = useState<string | null>(null);
  const [noteModal, setNoteModal] = useState<{ id: string; decision: 'confirmed' | 'invalid' } | null>(null);
  const [noteText, setNoteText] = useState('');

  // ── Data Fetching ──

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Record<string, unknown> = { page, limit: 25 };
    if (tab === 'open') params.status = 'open,reviewing';
    if (tab === 'resolved') params.status = 'resolved_valid,resolved_invalid';
    if (severityFilter) params.severity = severityFilter;
    if (flagTypeFilter) params.flagType = flagTypeFilter;
    if (searchQuery.trim()) params.search = searchQuery.trim();

    Promise.all([
      adminApi.getFraudFlags(params),
      adminApi.getFraudStats(),
    ])
      .then(([flagsRes, statsRes]) => {
        const flagsData = flagsRes.data as FraudFlagsResponse;
        setFlags(flagsData.flags || []);
        setTotal(flagsData.total || 0);
        setTotalPages(flagsData.totalPages || 1);
        setStats(statsRes.data as FraudStats);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load fraud data')))
      .finally(() => setLoading(false));
  }, [tab, severityFilter, flagTypeFilter, searchQuery, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [tab, severityFilter, flagTypeFilter, searchQuery]);

  // ── Actions ──

  const handleResolve = async (id: string, decision: 'confirmed' | 'invalid') => {
    setResolving(id);
    try {
      await adminApi.resolveFraudFlag(id, decision, decision === 'confirmed' ? 'Confirmed via admin review' : 'False positive — released');
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Resolve failed'));
    } finally {
      setResolving(null);
    }
  };

  const handleResolveWithNote = async () => {
    if (!noteModal) return;
    setResolving(noteModal.id);
    try {
      await adminApi.resolveFraudFlag(noteModal.id, noteModal.decision, noteText || undefined);
      setNoteModal(null);
      setNoteText('');
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Resolve failed'));
    } finally {
      setResolving(null);
    }
  };

  const handleRecomputeTrust = async (userId: string) => {
    setRecomputeUserId(userId);
    try {
      await adminApi.recomputeTrustScore(userId);
      // Refresh data to show updated trust level
      fetchData();
    } catch (err: unknown) {
      // The shared client rejects on any non-2xx, so a 500 (or any failure)
      // now surfaces visibly instead of looking like a success.
      setError(getErrorMessage(err, 'Trust recompute failed'));
    } finally {
      setRecomputeUserId(null);
    }
  };

  // ── Derived Stats ──

  const statsSummary = useMemo(() => {
    if (!stats) return null;
    const { byStatus, bySeverity, escalationRate, avgResolutionMinutes, resolvedLast7d } = stats;
    return { byStatus, bySeverity, escalationRate, avgResolutionMinutes, resolvedLast7d };
  }, [stats]);

  const openCount = stats?.byStatus.open ?? 0;

  // ── Render ──

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Fraud review dashboard</h1>
        <p className="text-ink-300 text-sm">Investigate flagged activity, resolve cases, and monitor trust scores</p>
      </div>

      {/* Stats overview */}
      {statsSummary && (
        <>
          {/* Main stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Open</p>
              <p className="text-2xl font-bold text-white">{formatNumber(statsSummary.byStatus.open)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Reviewing</p>
              <p className="text-2xl font-bold text-amber-400">{formatNumber(statsSummary.byStatus.reviewing)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Escalated</p>
              <p className="text-2xl font-bold text-red-400">{formatNumber(statsSummary.byStatus.escalated)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Resolved (7d)</p>
              <p className="text-2xl font-bold text-emerald-400">{formatNumber(statsSummary.resolvedLast7d)}</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Escalation rate</p>
              <p className="text-2xl font-bold text-white">{statsSummary.escalationRate}%</p>
            </div>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4">
              <p className="text-ink-400 text-xs uppercase tracking-wider mb-1">Avg resolution</p>
              <p className="text-2xl font-bold text-white">
                {statsSummary.avgResolutionMinutes < 60
                  ? `${statsSummary.avgResolutionMinutes}m`
                  : `${Math.round(statsSummary.avgResolutionMinutes / 60)}h ${statsSummary.avgResolutionMinutes % 60}m`}
              </p>
            </div>
          </div>

          {/* Severity & flag type distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Severity bars */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
              <h3 className="text-white text-sm font-semibold mb-3">Open flags by severity</h3>
              <div className="space-y-2">
                {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                  const count = statsSummary.bySeverity[sev];
                  const maxCount = Math.max(...Object.values(statsSummary.bySeverity), 1);
                  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  const info = SEVERITY_LABELS[sev];
                  return (
                    <div key={sev} className="flex items-center gap-3">
                      <span className="text-ink-300 text-xs w-14 capitalize">{info.label}</span>
                      <div className="flex-1 bg-ink-700 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${info.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-white text-xs font-mono w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Flag type breakdown */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
              <h3 className="text-white text-sm font-semibold mb-3">Flag type breakdown</h3>
              {stats && stats.byFlagType.length === 0 ? (
                <p className="text-ink-400 text-xs">No active flags</p>
              ) : stats ? (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {stats.byFlagType
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10)
                    .map((t) => {
                      const maxFt = Math.max(...stats.byFlagType.map((f) => f.count), 1);
                      const pct = (t.count / maxFt) * 100;
                      return (
                        <div key={t.type} className="flex items-center gap-2">
                          <span className="text-ink-300 text-xs flex-1 truncate">{flagTypeLabel(t.type)}</span>
                          <div className="w-24 bg-ink-700 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-white text-xs font-mono w-6 text-right">{t.count}</span>
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* Tabs & Filters */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-ink-800 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('open')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'open'
                ? 'bg-brand-500 text-white'
                : 'text-ink-300 hover:text-white'
            }`}
          >
            Open flags {openCount > 0 && `(${openCount})`}
          </button>
          <button
            onClick={() => setTab('resolved')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'resolved'
                ? 'bg-brand-500 text-white'
                : 'text-ink-300 hover:text-white'
            }`}
          >
            Resolved history
          </button>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Severity filter */}
          <div className="flex items-center gap-1">
            <span className="text-ink-400 text-xs mr-1">Severity:</span>
            {['', 'critical', 'high', 'medium', 'low'].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setSeverityFilter(severityFilter === s ? '' : s)}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  severityFilter === s
                    ? 'bg-brand-500 text-white'
                    : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          {/* Flag type filter */}
          <select
            value={flagTypeFilter}
            onChange={(e) => setFlagTypeFilter(e.target.value)}
            className="bg-ink-700 border border-ink-600/50 rounded-lg px-2.5 py-1 text-xs text-ink-200 focus:outline-none focus:border-brand-500"
          >
            <option value="">All types</option>
            {FLAG_TYPES.map((ft) => (
              <option key={ft} value={ft}>{flagTypeLabel(ft)}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs ml-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by user email..."
              className="w-full bg-ink-700 border border-ink-600/50 rounded-lg pl-3 pr-8 py-1.5 text-xs text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading && <LoadingSpinner />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="text-red-300 text-xs underline ml-4">Dismiss</button>
          </div>
        </div>
      )}

      {!loading && flags.length === 0 ? (
        <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
          <p className="text-ink-400 text-sm">
            {tab === 'open'
              ? 'No open fraud flags. The queue is clean.'
              : 'No resolved flags found matching your filters.'}
          </p>
        </div>
      ) : (
        <>
          {/* Flag list */}
          <div className="space-y-3">
            {flags.map((flag) => {
              const isOpen = flag.status === 'open' || flag.status === 'reviewing';
              const isExpanded = expandedFlag === flag.id;

              return (
                <div
                  key={flag.id}
                  className={`bg-ink-800 border rounded-xl transition-all ${
                    isOpen ? severityColor(flag.severity) : 'border-ink-600/30 opacity-80'
                  }`}
                >
                  {/* Flag header */}
                  <div
                    className="p-4 cursor-pointer"
                    onClick={() => setExpandedFlag(isExpanded ? null : flag.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${severityDot(flag.severity)}`} />
                        <StatusBadge status={flag.severity} />
                        <span className="text-ink-300 text-xs capitalize truncate">
                          {flagTypeLabel(flag.flagType)}
                        </span>
                        {flag.status !== 'open' && flag.status !== 'reviewing' && (
                          <StatusBadge status={flag.status} />
                        )}
                        <span className="text-ink-500 text-xs ml-auto">
                          {formatRelativeTime(flag.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-ink-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Reason */}
                    <p className="text-white text-sm mt-2 line-clamp-1">{flag.reason}</p>

                    {/* User info & trust level */}
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink-500 text-xs">User:</span>
                        <a
                          href={`/admin/users?search=${encodeURIComponent(flag.user?.email || flag.userId)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-400 hover:text-brand-300 text-xs underline truncate max-w-[180px]"
                        >
                          {flag.user?.email || flag.user?.name || flag.userId.slice(0, 8)}
                        </a>
                      </div>
                      {flag.user?.trustLevel && (
                        <span className={`text-xs font-medium ${trustLevelColor(flag.user.trustLevel)}`}>
                          {flag.user.trustLevel.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-ink-600/30 px-4 pb-4 pt-3 space-y-3">
                      {/* Evidence */}
                      {flag.evidence && Object.keys(flag.evidence).length > 0 && (
                        <div>
                          <p className="text-ink-400 text-xs font-medium mb-1">Evidence</p>
                          <pre className="bg-ink-700/50 rounded-lg p-3 text-xs text-ink-300 overflow-x-auto max-h-40 overflow-y-auto">
                            {JSON.stringify(flag.evidence, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Flag metadata */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <p className="text-ink-500">Flag ID</p>
                          <p className="text-ink-300 font-mono truncate">{flag.id.slice(0, 12)}...</p>
                        </div>
                        <div>
                          <p className="text-ink-500">User ID</p>
                          <p className="text-ink-300 font-mono truncate">{flag.userId.slice(0, 12)}...</p>
                        </div>
                        <div>
                          <p className="text-ink-500">Created</p>
                          <p className="text-ink-300">{new Date(flag.createdAt).toLocaleString()}</p>
                        </div>
                        {flag.resolvedAt && (
                          <div>
                            <p className="text-ink-500">Resolved</p>
                            <p className="text-ink-300">{new Date(flag.resolvedAt).toLocaleString()}</p>
                          </div>
                        )}
                      </div>

                      {/* Review note */}
                      {flag.reviewNote && (
                        <div>
                          <p className="text-ink-400 text-xs font-medium mb-1">Review note</p>
                          <p className="text-ink-300 text-xs bg-ink-700/50 rounded-lg p-2">{flag.reviewNote}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        {isOpen && (
                          <>
                            <button
                              onClick={() => setNoteModal({ id: flag.id, decision: 'invalid' })}
                              disabled={resolving === flag.id}
                              className="bg-ink-700 hover:bg-ink-600 text-emerald-400 text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Mark invalid
                            </button>
                            <button
                              onClick={() => handleResolve(flag.id, 'confirmed')}
                              disabled={resolving === flag.id}
                              className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                            >
                              {resolving === flag.id ? 'Resolving...' : 'Confirm fraud'}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleRecomputeTrust(flag.userId)}
                          disabled={recomputeUserId === flag.userId}
                          className="bg-ink-700 hover:bg-ink-600 text-ink-300 text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ml-auto"
                        >
                          {recomputeUserId === flag.userId ? 'Recomputing...' : 'Recompute trust'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-ink-600/30">
              <p className="text-ink-400 text-xs">
                Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} flags
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="bg-ink-700 hover:bg-ink-600 disabled:opacity-30 text-ink-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  ← Prev
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        p === page
                          ? 'bg-brand-500 text-white'
                          : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="bg-ink-700 hover:bg-ink-600 disabled:opacity-30 text-ink-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Resolve with note modal */}
      {noteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-white font-semibold mb-2">
              {noteModal.decision === 'confirmed' ? 'Confirm fraud' : 'Mark as invalid'}
            </h3>
            <p className="text-ink-400 text-sm mb-4">
              {noteModal.decision === 'confirmed'
                ? 'This will reverse the associated earnings and penalize the user\'s trust score.'
                : 'This will release any held earnings and restore the user\'s trust score.'}
            </p>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Optional note — internal review notes (not visible to user)"
              rows={3}
              maxLength={500}
              className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 mb-4 text-sm"
            />
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => { setNoteModal(null); setNoteText(''); }}
                className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveWithNote}
                disabled={resolving === noteModal.id}
                className={`${
                  noteModal.decision === 'confirmed'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-emerald-500 hover:bg-emerald-600'
                } disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm`}
              >
                {resolving === noteModal.id ? 'Resolving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
