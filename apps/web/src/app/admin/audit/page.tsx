'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
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
  entries?: AuditEntry[];
  logs?: AuditEntry[];
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);

    // The audit endpoint returns paginated entries; we render a flat list
    // when present.
    adminApi
      .getAuditLog({
        actorRole: actorFilter || undefined,
        action: actionFilter || undefined,
      })
      .then((res: { data?: AuditLogResponse }) => {
        if (!res) return;
        setEntries(res.data?.entries || res.data?.logs || []);
      })
      .catch((err: unknown) => {
        setError(getErrorMessage(err, 'Failed to load audit log'));
      })
      .finally(() => setLoading(false));
  }, [actorFilter, actionFilter]);

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Audit log</h1>
          <p className="text-ink-300 text-sm">
            Append-only record of admin and system actions
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="bg-ink-800 border border-ink-600/50 rounded-lg px-4 py-2 text-white text-sm"
          >
            <option value="">All actors</option>
            <option value="admin">Admin</option>
            <option value="support">Support</option>
            <option value="system">System</option>
          </select>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filter by action..."
            className="bg-ink-800 border border-ink-600/50 rounded-lg px-4 py-2 text-white placeholder:text-ink-400 text-sm focus:outline-none focus:border-brand-500"
          />
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
          {entries.length === 0 && !loading ? (
            <div className="text-ink-400 text-sm py-12 text-center">
              No audit entries match the current filters. Audit log will populate as actions are recorded.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-700/50 border-b border-ink-600/30">
                <tr>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">When</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Actor</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Action</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Target</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600/20">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-ink-700/30 transition-colors">
                    <td className="px-4 py-3 text-ink-300 text-xs">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          e.actorRole === 'admin'
                            ? 'bg-red-500/20 text-red-400'
                            : e.actorRole === 'system'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {e.actorRole}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white font-mono text-xs">{e.action}</td>
                    <td className="px-4 py-3 text-ink-400 text-xs">
                      {e.targetType && (
                        <span>
                          {e.targetType} · <span className="font-mono">{e.targetId?.slice(0, 8)}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-500 text-xs font-mono">{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      
</>
);
}
