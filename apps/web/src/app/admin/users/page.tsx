'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, Pill } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
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
    setError(null);
    adminApi
      .getUsers({ search: search || undefined, role: roleFilter || undefined })
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
      const res = await adminApi.getUsers({
        search: search || undefined,
        role: roleFilter || undefined,
      });
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
      <PageHeader eyebrow="Admin" title="Users" lede="Search and review account holders" />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="dash-eyebrow mb-1.5 block">Search users</span>
          <input
            id="admin-users-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email or name..."
            className="px-4 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="dash-eyebrow mb-1.5 block">Role</span>
          <select
            id="admin-users-role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2 text-sm"
          >
            <option value="">All roles</option>
            <option value="developer">Developer</option>
            <option value="advertiser">Advertiser</option>
            <option value="admin">Admin</option>
            <option value="support">Support</option>
          </select>
        </label>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      <Panel label="Users" flush>
        <div aria-busy={loading}>
          {!loading && !error && users.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">No users found.</div>
          ) : !loading && !error ? (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Users table, scrolls horizontally"
            >
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <th className="text-left">User</th>
                    <th className="text-left">Role</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Trust</th>
                    <th className="text-left">Flags</th>
                    <th className="text-right">Joined</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div>
                          <p className="text-sm text-[var(--ink)]">{u.name || u.email}</p>
                          <p className="text-xs text-[var(--muted)]">{u.email}</p>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={u.role} kind="metadata" />
                      </td>
                      <td>
                        <Pill
                          tone={
                            u.status === 'banned'
                              ? 'bad'
                              : u.status === 'restricted'
                                ? 'warn'
                                : 'ok'
                          }
                        >
                          {u.status}
                        </Pill>
                      </td>
                      <td>
                        <span className="dash-mono text-sm text-[var(--ink)]">
                          {TRUST_LEVEL_SCORE[u.trustLevel] ?? 0}/100
                          <span className="ml-1 text-xs normal-case text-[var(--muted)]">
                            ({u.trustLevel})
                          </span>
                        </span>
                      </td>
                      <td>
                        {u.openFlags > 0 ? (
                          <Pill tone="bad">{u.openFlags} open</Pill>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="text-right text-xs text-[var(--muted)]">
                        {formatRelativeTime(u.createdAt)}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          {u.status === 'banned' ? (
                            <button
                              type="button"
                              onClick={() => openAction(u, 'unban')}
                              className="dash-btn dash-btn--ghost dash-btn--sm"
                            >
                              Unban
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                openAction(u, u.status === 'restricted' ? 'restrict' : 'ban')
                              }
                              className="dash-btn dash-btn--ghost dash-btn--sm"
                            >
                              {u.status === 'restricted' ? 'Restrict' : 'Ban'}
                            </button>
                          )}
                          {u.role !== 'super_admin' && u.role !== 'admin' && (
                            <button
                              type="button"
                              onClick={() => openAction(u, 'erase')}
                              className="dash-btn dash-btn--danger dash-btn--sm"
                            >
                              Erase
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Panel>

      {users.length > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-[var(--muted)]">
            Showing {Math.min((safePage - 1) * pageSize + 1, users.length)}–
            {Math.min(safePage * pageSize, users.length)} of {users.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="dash-btn dash-btn--glass dash-btn--sm"
            >
              Previous
            </button>
            <span className="px-2 text-[var(--copy)]">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="dash-btn dash-btn--glass dash-btn--sm"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* A-028: account lifecycle actions are now reachable from the UI with a
            confirmation modal. Erasure is irreversible and requires typing a
            confirmation phrase; super-admins cannot be erased from the UI. */}
      {actionUser && actionKind && (
        <ModalDialog
          open
          onClose={() => {
            setActionUser(null);
            setActionKind(null);
            setConfirmText('');
          }}
          labelledBy="admin-user-action-title"
        >
          <h2 id="admin-user-action-title" className="mb-2 text-lg font-semibold text-[var(--ink)]">
            {actionKind === 'erase'
              ? 'Erase account'
              : actionKind === 'ban'
                ? 'Ban user'
                : actionKind === 'unban'
                  ? 'Unban user'
                  : 'Restrict user'}
          </h2>
          <p className="mb-4 text-sm text-[var(--copy)]">
            {actionKind === 'erase' ? (
              <>
                This permanently anonymizes{' '}
                <span className="text-[var(--ink)]">{actionUser.email}</span> and cannot be undone.
              </>
            ) : (
              <>
                Apply this action to <span className="text-[var(--ink)]">{actionUser.email}</span>?
              </>
            )}
          </p>
          {actionKind === 'erase' && (
            <label className="block">
              <span className="sr-only">Confirmation phrase</span>
              <input
                id="admin-user-confirmation"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type "ERASE" to confirm'
                className="mb-4 w-full px-3 py-2 text-sm"
              />
            </label>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setActionUser(null);
                setActionKind(null);
                setConfirmText('');
              }}
              className="dash-btn dash-btn--ghost dash-btn--md"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || (actionKind === 'erase' && confirmText !== 'ERASE')}
              onClick={runAction}
              className={`dash-btn dash-btn--md ${
                actionKind === 'erase' ? 'dash-btn--danger' : 'dash-btn--primary'
              }`}
            >
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
