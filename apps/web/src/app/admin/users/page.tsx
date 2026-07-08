'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

interface User {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  status: string;
  trustLevel: string;
  country?: string | null;
  openFlags: number;
  createdAt: string;
}

const TRUST_LEVEL_SCORE: Record<string, number> = {
  new: 10,
  low_trust: 30,
  normal: 60,
  high_trust: 85,
  restricted: 20,
  banned: 0,
};

function trustColorClass(level: string): string {
  switch (level) {
    case 'high_trust': return 'text-emerald-400';
    case 'normal': return 'text-blue-400';
    case 'low_trust': return 'text-amber-400';
    case 'new': return 'text-ink-400';
    case 'restricted':
    case 'banned': return 'text-red-400';
    default: return 'text-ink-400';
  }
}

type UsersResponse = User[] | { users?: User[] };

function normalizeUsers(data: UsersResponse): User[] {
  return Array.isArray(data) ? data : data.users || [];
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [actionUser, setActionUser] = useState<User | null>(null);
  const [actionKind, setActionKind] = useState<'erase' | 'restrict' | 'ban' | 'unban' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    setLoading(true);
    adminApi.getUsers({ search: search || undefined, role: roleFilter || undefined })
      .then((res: { data: UsersResponse }) => setUsers(normalizeUsers(res.data)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load users')))
      .finally(() => setLoading(false));
  }, [search, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleUsers = users.slice((safePage - 1) * pageSize, safePage * pageSize);

  const runAction = async () => {
    if (!actionUser || !actionKind) return;
    setBusy(true);
    try {
      if (actionKind === 'erase') {
        await adminApi.eraseUser(actionUser.id);
      } else if (actionKind === 'restrict') {
        await adminApi.setUserStatus(actionUser.id, 'restricted');
      } else if (actionKind === 'ban') {
        await adminApi.setUserStatus(actionUser.id, 'banned');
      } else if (actionKind === 'unban') {
        await adminApi.setUserStatus(actionUser.id, 'active');
      }
      setActionUser(null);
      setActionKind(null);
      setConfirmText('');
      const res = await adminApi.getUsers({ search: search || undefined, role: roleFilter || undefined });
      setUsers(normalizeUsers(res.data as UsersResponse));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(false);
    }
  };

  const openAction = (u: User, kind: 'erase' | 'restrict' | 'ban' | 'unban') => {
    setActionUser(u);
    setActionKind(kind);
    setConfirmText('');
  };

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Users</h1>
          <p className="text-ink-300 text-sm">Search and review account holders</p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email or name..."
            className="bg-ink-800 border border-ink-600/50 rounded-lg px-4 py-2 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 text-sm"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-ink-800 border border-ink-600/50 rounded-lg px-4 py-2 text-white text-sm"
          >
            <option value="">All roles</option>
            <option value="developer">Developer</option>
            <option value="advertiser">Advertiser</option>
            <option value="admin">Admin</option>
            <option value="support">Support</option>
          </select>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
          {users.length === 0 ? (
            <div className="text-ink-400 text-sm py-12 text-center">No users found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-700/50 border-b border-ink-600/30">
                <tr>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">User</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Role</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Trust</th>
                  <th className="text-left px-4 py-3 text-ink-300 font-medium">Flags</th>
                  <th className="text-right px-4 py-3 text-ink-300 font-medium">Joined</th>
                  <th className="text-right px-4 py-3 text-ink-300 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600/20">
                {visibleUsers.map((u) => (
                <tr key={u.id} className="hover:bg-ink-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-white text-sm">{u.name || u.email}</p>
                      <p className="text-ink-500 text-xs">{u.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.role} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        u.status === 'banned'
                          ? 'text-red-400'
                          : u.status === 'restricted'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`font-mono text-sm ${trustColorClass(u.trustLevel)}`}>
                      {TRUST_LEVEL_SCORE[u.trustLevel] ?? 0}/100
                      <span className="ml-1 text-ink-500 text-xs normal-case">({u.trustLevel})</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.openFlags > 0 ? (
                      <span className="text-red-400 text-xs font-medium">{u.openFlags} open</span>
                    ) : (
                      <span className="text-ink-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-400 text-xs">
                    {formatRelativeTime(u.createdAt)}
                  </td>
                </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {users.length > pageSize && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <p className="text-ink-400">
              Showing {Math.min((safePage - 1) * pageSize + 1, users.length)}–{Math.min(safePage * pageSize, users.length)} of {users.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="bg-ink-800 border border-ink-600/50 rounded-lg px-3 py-1.5 text-white text-sm disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <span className="text-ink-300 px-2">Page {safePage} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="bg-ink-800 border border-ink-600/50 rounded-lg px-3 py-1.5 text-white text-sm disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
       
</>
);
}
