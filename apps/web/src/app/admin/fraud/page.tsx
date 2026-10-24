'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, Stat } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatNumber, formatRelativeTime } from '@/lib/format';

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

const SEVERITY_LABELS: Record<string, { label: string }> = {
  critical: { label: 'Critical' },
  high: { label: 'High' },
  medium: { label: 'Medium' },
  low: { label: 'Low' },
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
  const [noteModal, setNoteModal] = useState<{
    id: string;
    decision: 'confirmed' | 'invalid';
  } | null>(null);
  const [noteText, setNoteText] = useState('');

  // ── Data Fetching ──

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Record<string, unknown> = { page, limit: 25 };
    if (tab === 'open') params.status = 'open,reviewing,escalated';
    if (tab === 'resolved') params.status = 'resolved_valid,resolved_invalid';
    if (severityFilter) params.severity = severityFilter;
    if (flagTypeFilter) params.flagType = flagTypeFilter;
    if (searchQuery.trim()) params.search = searchQuery.trim();

    Promise.all([adminApi.getFraudFlags(params), adminApi.getFraudStats()])
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
      await adminApi.resolveFraudFlag(
        id,
        decision,
        decision === 'confirmed' ? 'Confirmed via admin review' : 'False positive, released',
      );
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Resolve failed'));
    } finally {
      setResolving(null);
    }
  };

  const handleEscalate = async (id: string) => {
    setResolving(id);
    try {
      await adminApi.escalateFraudFlag(id, 'Escalated for senior review');
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Escalate failed'));
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

  const activeCount = stats
    ? stats.byStatus.open + stats.byStatus.reviewing + stats.byStatus.escalated
    : 0;

  // ── Render ──

  return (
    <>
      {/* Header */}
      <PageHeader title="Fraud review" />

      {/* Stats overview */}
      {statsSummary && (
        <>
          {/* Main stat cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Panel label="Open">
              <Stat label="Open" value={formatNumber(statsSummary.byStatus.open)} />
            </Panel>
            <Panel label="Reviewing">
              <Stat label="Reviewing" value={formatNumber(statsSummary.byStatus.reviewing)} />
            </Panel>
            <Panel label="Escalated">
              <Stat label="Escalated" value={formatNumber(statsSummary.byStatus.escalated)} />
            </Panel>
            <Panel label="Resolved (7d)">
              <Stat label="Resolved (7d)" value={formatNumber(statsSummary.resolvedLast7d)} />
            </Panel>
            <Panel label="Escalation rate">
              <Stat label="Escalation rate" value={`${statsSummary.escalationRate}%`} />
            </Panel>
            <Panel label="Avg resolution">
              <Stat
                label="Avg resolution"
                value={
                  statsSummary.avgResolutionMinutes < 60
                    ? `${statsSummary.avgResolutionMinutes}m`
                    : `${Math.round(statsSummary.avgResolutionMinutes / 60)}h ${statsSummary.avgResolutionMinutes % 60}m`
                }
              />
            </Panel>
          </div>

          {/* Severity & flag type distribution */}
          <div className="dash-grid dash-grid--2">
            {/* Severity bars */}
            <Panel label="Open flags by severity">
              <PanelHeader title="Open flags by severity" />
              <div className="space-y-2">
                {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                  const count = statsSummary.bySeverity[sev];
                  const maxCount = Math.max(...Object.values(statsSummary.bySeverity), 1);
                  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  const info = SEVERITY_LABELS[sev];
                  return (
                    <div key={sev} className="flex items-center gap-3">
                      <span className="w-14 text-xs capitalize text-[var(--copy)]">
                        {info.label}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--hair)]">
                        <div
                          className="h-full rounded-full bg-[var(--ink)] transition-all duration-500 motion-reduce:transition-none"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="dash-mono w-8 text-right text-xs text-[var(--ink)]">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Flag type breakdown */}
            <Panel label="Flag type breakdown">
              <PanelHeader title="Flag type breakdown" />
              {stats && stats.byFlagType.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No active flags</p>
              ) : stats ? (
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {stats.byFlagType
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10)
                    .map((t) => {
                      const maxFt = Math.max(...stats.byFlagType.map((f) => f.count), 1);
                      const pct = (t.count / maxFt) * 100;
                      return (
                        <div key={t.type} className="flex items-center gap-2">
                          <span className="flex-1 truncate text-xs text-[var(--copy)]">
                            {flagTypeLabel(t.type)}
                          </span>
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--hair)]">
                            <div
                              className="h-full rounded-full bg-[var(--ink)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="dash-mono w-6 text-right text-xs text-[var(--ink)]">
                            {t.count}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </Panel>
          </div>
        </>
      )}

      {/* Tabs & Filters */}
      <div className="flex flex-col gap-4">
        {/* Tab bar */}
        <div className="flex w-fit items-center gap-2">
          <button
            onClick={() => setTab('open')}
            className={`dash-btn dash-btn--sm ${
              tab === 'open' ? 'dash-btn--primary' : 'dash-btn--secondary'
            }`}
          >
            Active flags {activeCount > 0 && `(${activeCount})`}
          </button>
          <button
            onClick={() => setTab('resolved')}
            className={`dash-btn dash-btn--sm ${
              tab === 'resolved' ? 'dash-btn--primary' : 'dash-btn--secondary'
            }`}
          >
            Resolved history
          </button>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Severity filter */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-[var(--muted)]">Severity:</span>
            {['', 'critical', 'high', 'medium', 'low'].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setSeverityFilter(severityFilter === s ? '' : s)}
                className={`dash-btn dash-btn--sm ${
                  severityFilter === s ? 'dash-btn--primary' : 'dash-btn--secondary'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          {/* Flag type filter */}
          <label>
            <span className="sr-only">Filter by flag type</span>
            <select
              aria-label="Filter by flag type"
              value={flagTypeFilter}
              onChange={(e) => setFlagTypeFilter(e.target.value)}
              className="px-2.5 py-1 text-xs"
            >
              <option value="">All types</option>
              {FLAG_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {flagTypeLabel(ft)}
                </option>
              ))}
            </select>
          </label>

          {/* Search */}
          <div className="relative ml-auto min-w-[200px] max-w-xs flex-1">
            <input
              aria-label="Search fraud flags by user email"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by user email..."
              className="w-full py-1.5 pl-3 pr-8 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear fraud flag user search"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-2 my-auto h-fit text-[var(--muted)] hover:text-[var(--ink)]"
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
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              onClick={() => setError(null)}
              className="dash-btn dash-btn--ghost dash-btn--sm"
            >
              Dismiss
            </button>
          }
        >
          {error}
        </Notice>
      )}

      {!loading && flags.length === 0 ? (
        <Panel label="No fraud flags">
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            {tab === 'open'
              ? 'No active fraud flags. The queue is clean.'
              : 'No resolved flags found matching your filters.'}
          </p>
        </Panel>
      ) : (
        <>
          {/* Flag list */}
          <Panel label="Fraud flags" flush>
            <div className="dash-rows">
              {flags.map((flag) => {
                const isActive =
                  flag.status === 'open' ||
                  flag.status === 'reviewing' ||
                  flag.status === 'escalated';
                const isExpanded = expandedFlag === flag.id;

                return (
                  <div key={flag.id} className={isActive ? '' : 'opacity-80'}>
                    {/* Flag header */}
                    <div
                      className="cursor-pointer"
                      onClick={() => setExpandedFlag(isExpanded ? null : flag.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <StatusBadge status={flag.severity} />
                          <span className="truncate text-xs capitalize text-[var(--copy)]">
                            {flagTypeLabel(flag.flagType)}
                          </span>
                          {flag.status !== 'open' && flag.status !== 'reviewing' && (
                            <StatusBadge status={flag.status} />
                          )}
                          <span className="ml-auto text-xs text-[var(--muted)]">
                            {formatRelativeTime(flag.createdAt)}
                          </span>
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-2">
                          <span className="text-xs text-[var(--muted)]">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>

                      {/* Reason */}
                      <p className="mt-2 line-clamp-1 text-sm text-[var(--ink)]">{flag.reason}</p>

                      {/* User info & trust level */}
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-[var(--muted)]">User:</span>
                          <a
                            href={`/admin/users?search=${encodeURIComponent(flag.user?.email || flag.userId)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="max-w-[180px] truncate text-xs text-[var(--ink)] underline"
                          >
                            {flag.user?.email || flag.user?.name || flag.userId.slice(0, 8)}
                          </a>
                        </div>
                        {flag.user?.trustLevel && (
                          <Pill>{flag.user.trustLevel.replace(/_/g, ' ')}</Pill>
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-[var(--hair)] pt-3">
                        {/* Evidence */}
                        {flag.evidence && Object.keys(flag.evidence).length > 0 && (
                          <div>
                            <p className="dash-eyebrow mb-1">Evidence</p>
                            <pre className="dash-mono max-h-40 overflow-x-auto overflow-y-auto rounded-xl border border-[var(--hair)] bg-[var(--page)] p-3 text-xs text-[var(--ink)]">
                              {JSON.stringify(flag.evidence, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Flag metadata */}
                        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                          <div>
                            <p className="text-[var(--muted)]">Flag ID</p>
                            <p className="dash-mono truncate text-[var(--ink)]">
                              {flag.id.slice(0, 12)}...
                            </p>
                          </div>
                          <div>
                            <p className="text-[var(--muted)]">User ID</p>
                            <p className="dash-mono truncate text-[var(--ink)]">
                              {flag.userId.slice(0, 12)}...
                            </p>
                          </div>
                          <div>
                            <p className="text-[var(--muted)]">Created</p>
                            <p className="text-[var(--ink)]">
                              {new Date(flag.createdAt).toLocaleString()}
                            </p>
                          </div>
                          {flag.resolvedAt && (
                            <div>
                              <p className="text-[var(--muted)]">Resolved</p>
                              <p className="text-[var(--ink)]">
                                {new Date(flag.resolvedAt).toLocaleString()}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Review note */}
                        {flag.reviewNote && (
                          <div>
                            <p className="dash-eyebrow mb-1">Review note</p>
                            <p className="rounded-xl border border-[var(--hair)] bg-[var(--page)] p-2 text-xs text-[var(--ink)]">
                              {flag.reviewNote}
                            </p>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {isActive && (
                            <>
                              <button
                                onClick={() => setNoteModal({ id: flag.id, decision: 'invalid' })}
                                disabled={resolving === flag.id}
                                className="dash-btn dash-btn--secondary dash-btn--sm"
                              >
                                Mark invalid
                              </button>
                              {flag.status !== 'escalated' && (
                                <button
                                  onClick={() => handleEscalate(flag.id)}
                                  disabled={resolving === flag.id}
                                  className="dash-btn dash-btn--secondary dash-btn--sm"
                                >
                                  {resolving === flag.id ? 'Escalating...' : 'Escalate'}
                                </button>
                              )}
                              <button
                                onClick={() => handleResolve(flag.id, 'confirmed')}
                                disabled={resolving === flag.id}
                                className="dash-btn dash-btn--danger dash-btn--sm"
                              >
                                {resolving === flag.id ? 'Resolving...' : 'Confirm fraud'}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleRecomputeTrust(flag.userId)}
                            disabled={recomputeUserId === flag.userId}
                            className="dash-btn dash-btn--ghost dash-btn--sm sm:ml-auto"
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
          </Panel>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--hair)] pt-4">
              <p className="text-xs text-[var(--muted)]">
                Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} flags
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="dash-btn dash-btn--secondary dash-btn--sm"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  if (p > totalPages) return null;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`dash-btn dash-btn--sm ${
                        p === page ? 'dash-btn--primary' : 'dash-btn--secondary'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="dash-btn dash-btn--secondary dash-btn--sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Resolve with note modal */}
      {noteModal && (
        <ModalDialog
          open
          onClose={() => {
            setNoteModal(null);
            setNoteText('');
          }}
          labelledBy="admin-fraud-resolution-title"
        >
          <h3 id="admin-fraud-resolution-title" className="mb-2 font-semibold text-[var(--ink)]">
            {noteModal.decision === 'confirmed' ? 'Confirm fraud' : 'Mark as invalid'}
          </h3>
          <p className="mb-4 text-sm text-[var(--copy)]">
            {noteModal.decision === 'confirmed'
              ? "This will reverse the associated earnings and penalize the user's trust score."
              : "This will release any held earnings and restore the user's trust score."}
          </p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Optional internal note (the user never sees it)"
            rows={3}
            maxLength={500}
            className="mb-4 w-full px-4 py-3 text-sm"
          />
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setNoteModal(null);
                setNoteText('');
              }}
              className="dash-btn dash-btn--secondary dash-btn--md"
            >
              Cancel
            </button>
            <button
              onClick={handleResolveWithNote}
              disabled={resolving === noteModal.id}
              className={`dash-btn dash-btn--md ${
                noteModal.decision === 'confirmed' ? 'dash-btn--danger' : 'dash-btn--primary'
              }`}
            >
              {resolving === noteModal.id ? 'Resolving...' : 'Confirm'}
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
