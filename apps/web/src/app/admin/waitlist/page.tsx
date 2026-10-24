'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel } from '@/components/dash';
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
      <PageHeader
        eyebrow="Admin"
        title="Advertiser waitlist"
        lede="Review sponsor-interest signups captured while advertiser billing is closed."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Status</span>
          <select
            id="admin-waitlist-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | WaitlistStatus)}
            className="px-4 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-[var(--muted)]" aria-live="polite">
          {total.toLocaleString()} signup{total === 1 ? '' : 's'}
        </p>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={loadWaitlist}
              className="dash-btn dash-btn--glass dash-btn--sm"
            >
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}

      <Panel label="Advertiser waitlist" flush>
        {!loading && !error && entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted)]">
            No waitlist signups match this filter.
          </div>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Advertiser waitlist table, scrolls horizontally"
          >
            <table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>Joined</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Consent</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-xs">
                      <time
                        dateTime={entry.createdAt}
                        title={new Date(entry.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(entry.createdAt)}
                      </time>
                    </td>
                    <td className="text-[var(--ink)]">{entry.email}</td>
                    <td>{entry.company || '—'}</td>
                    <td>{entry.country || '—'}</td>
                    <td>
                      <StatusBadge status={formatStatus(entry.status)} />
                    </td>
                    <td>{entry.consent ? 'Granted' : '—'}</td>
                    <td className="text-xs">{entry.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--muted)]">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
            className="dash-btn dash-btn--glass dash-btn--sm"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
            className="dash-btn dash-btn--glass dash-btn--sm"
          >
            Next
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Read-only view. Waitlist status changes and GDPR erasure are handled through separate
        operator workflows.
      </p>
    </>
  );
}
