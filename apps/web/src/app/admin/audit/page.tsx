'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, Pill, type Tone } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';

interface AuditEntry {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

interface AuditLogResponse {
  items?: AuditEntry[];
  total?: number;
  page?: number;
  limit?: number;
}

const PAGE_SIZE = 50;

function roleTone(role: string): Tone {
  return role === 'admin' ? 'warn' : 'neutral';
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);

    adminApi
      .getAuditLog({
        actorRole: actorFilter || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((res: { data?: AuditLogResponse }) => {
        if (!res) return;
        setEntries(res.data?.items || []);
        setTotal(res.data?.total ?? 0);
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, 'Failed to load audit log'));
      })
      .finally(() => setLoading(false));
  }, [actorFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [actorFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleEntries = actionFilter.trim()
    ? entries.filter((e) => e.action.toLowerCase().includes(actionFilter.trim().toLowerCase()))
    : entries;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Audit log"
        lede="Append-only record of admin and system actions"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Actor role</span>
          <select
            id="admin-audit-actor"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="px-4 py-2 text-sm"
          >
            <option value="">All actors</option>
            <option value="admin">Admin</option>
            <option value="support">Support</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
            Action (current page)
          </span>
          <input
            id="admin-audit-action"
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by action..."
            className="px-4 py-2 text-sm"
          />
        </label>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      <Panel label="Audit log" flush>
        {visibleEntries.length === 0 && !loading ? (
          <div className="py-12 text-center text-sm text-[var(--muted)]">
            No audit entries match the current filters. Audit log will populate as actions are
            recorded.
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Audit log table, scrolls horizontally"
          >
            <table className="min-w-[760px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="text-xs">
                      <Pill tone={roleTone(e.actorRole)}>{e.actorRole}</Pill>
                    </td>
                    <td className="dash-mono text-xs text-[var(--ink)]">{e.action}</td>
                    <td className="text-xs">
                      {e.targetType && (
                        <span>
                          {e.targetType} ·{' '}
                          <span className="dash-mono">{e.targetId?.slice(0, 8)}</span>
                        </span>
                      )}
                    </td>
                    <td className="dash-mono text-xs">{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--muted)]">
          {total.toLocaleString()} entries · page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="dash-btn dash-btn--glass dash-btn--sm"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="dash-btn dash-btn--glass dash-btn--sm"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
