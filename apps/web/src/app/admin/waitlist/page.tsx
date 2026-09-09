'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

type WaitlistStatus = 'pending' | 'invited' | 'onboarded' | 'declined';

interface WaitlistEntry {
  id: string;
  email: string;
  company: string | null;
  country: string | null;
  status: WaitlistStatus;
  consent: boolean;
  source: string;
  createdAt: string;
}

interface WaitlistResponse {
  rows: WaitlistEntry[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 50;

const STATUS_OPTIONS: Array<{ value: '' | WaitlistStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'invited', label: 'Invited' },
  { value: 'onboarded', label: 'Onboarded' },
  { value: 'declined', label: 'Declined' },
];

function formatStatus(status: WaitlistStatus): string {
  return status.replace(/_/g, ' ');
}

export default function AdminWaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | WaitlistStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWaitlist = useCallback(() => {
    setLoading(true);
    setError(null);

    adminApi
      .getWaitlist({
        ...(statusFilter ? { status: statusFilter } : {}),
        page,
        limit: PAGE_SIZE,
      })
      .then((res: { data: WaitlistResponse }) => {
        setEntries(res.data.rows || []);
        setTotal(res.data.total || 0);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load waitlist')))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  useEffect(() => {
    loadWaitlist();
  }, [loadWaitlist]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Advertiser waitlist</h1>
        <p className="text-ink-200 text-sm">
          Review sponsor-interest signups captured while advertiser billing is closed.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-300">Status</span>
          <select
            id="admin-waitlist-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | WaitlistStatus)}
            className="bg-ink-800 border border-ink-600/50 rounded-lg px-4 py-2 text-white text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-ink-300 text-sm" aria-live="polite">
          {total.toLocaleString()} signup{total === 1 ? '' : 's'}
        </p>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            type="button"
            onClick={loadWaitlist}
            className="text-red-300 text-xs underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
        {!loading && !error && entries.length === 0 ? (
          <div className="text-ink-300 text-sm py-12 text-center">
            No waitlist signups match this filter.
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Advertiser waitlist table, scrolls horizontally"
          >
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-ink-700/50 border-b border-ink-600/30">
                <tr>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Joined</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Company</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Country</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Consent</th>
                  <th className="text-left px-4 py-3 text-ink-200 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600/20">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-ink-700/30 transition-colors">
                    <td className="px-4 py-3 text-ink-200 text-xs">
                      <time
                        dateTime={entry.createdAt}
                        title={new Date(entry.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(entry.createdAt)}
                      </time>
                    </td>
                    <td className="px-4 py-3 text-white">{entry.email}</td>
                    <td className="px-4 py-3 text-ink-200">{entry.company || '—'}</td>
                    <td className="px-4 py-3 text-ink-200">{entry.country || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={formatStatus(entry.status)} />
                    </td>
                    <td className="px-4 py-3 text-ink-200">{entry.consent ? 'Granted' : '—'}</td>
                    <td className="px-4 py-3 text-ink-300 text-xs">{entry.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-ink-300">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-lg bg-ink-800 border border-ink-600/50 text-white text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 rounded-lg bg-ink-800 border border-ink-600/50 text-white text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <p className="mt-5 text-xs text-ink-500">
        Read-only view. Waitlist status changes and GDPR erasure are handled through separate
        operator workflows.
      </p>
    </>
  );
}
