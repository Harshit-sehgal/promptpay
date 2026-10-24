'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Notice } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, type PeopleWaitlistParams } from '@/lib/api/services';
import type { CsvColumn } from '@/lib/csv';
import { formatRelativeTime } from '@/lib/format';

import { DebouncedInput, formatDay, Pager } from './controls';
import { ExportButton } from './export-button';
import { TagFilter } from './tag-filter';
import { TagChips } from './tags-editor';
import {
  type ListResponse,
  PAGE_SIZE,
  type PeopleQuery,
  type PeopleSummary,
  WAITLIST_STATUSES,
  type WaitlistRow,
  type WaitlistStatus,
} from './types';
import { WaitlistDetailDialog } from './waitlist-detail';

const isCountryCode = (value: string) => value.length === 0 || value.length === 2;
const upper = (value: string) => value.toUpperCase();
const label = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

const EXPORT_COLUMNS: CsvColumn<WaitlistRow>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Email', value: (r) => r.email },
  { header: 'Company', value: (r) => r.company },
  { header: 'Country', value: (r) => r.country },
  { header: 'Status', value: (r) => r.status },
  { header: 'Consent', value: (r) => r.consent },
  { header: 'Source', value: (r) => r.source },
  { header: 'Joined', value: (r) => r.createdAt },
  { header: 'Updated', value: (r) => r.updatedAt },
  { header: 'Registered user ID', value: (r) => r.registeredUserId },
  { header: 'Tags', value: (r) => (r.tags ?? []).join('; ') },
];

export function WaitlistTab({
  query,
  summary,
  onQuery,
  onOpen,
  onStatusChanged,
  version,
  onTagsChanged,
}: {
  query: PeopleQuery;
  summary: PeopleSummary | null;
  onQuery: (patch: Partial<PeopleQuery>) => void;
  onOpen: (id: string) => void;
  /** Called after a status write succeeds so the counts can be refreshed. */
  onStatusChanged: () => void;
  /** Changes when tags were edited, to reload the rows and tag choices. */
  version: number;
  /** Called after tags save in the notes dialog. */
  onTagsChanged: () => void;
}) {
  const [data, setData] = useState<ListResponse<WaitlistRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState<string | null>(null);
  const [notesRow, setNotesRow] = useState<WaitlistRow | null>(null);
  const closeNotes = useCallback(() => setNotesRow(null), []);

  const filters = useMemo<PeopleWaitlistParams>(
    () => ({
      ...(query.q ? { search: query.q } : {}),
      ...(query.status ? { status: query.status as WaitlistStatus } : {}),
      ...(query.country ? { country: query.country } : {}),
      ...(query.tag ? { tag: query.tag } : {}),
    }),
    [query.q, query.status, query.country, query.tag],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getPeopleWaitlist({ ...filters, page: query.page, limit: PAGE_SIZE })
      .then((res: { data: ListResponse<WaitlistRow> }) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the waitlist'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, query.page, attempt, version]);

  const patchRow = (id: string, patch: Partial<WaitlistRow>) =>
    setData((current) =>
      current
        ? { ...current, rows: current.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
        : current,
    );

  const changeStatus = async (row: WaitlistRow, next: WaitlistStatus) => {
    const previous = row.status;
    if (next === previous) return;
    setStatusError(null);
    patchRow(row.id, { status: next });
    setSaving((current) => new Set(current).add(row.id));
    try {
      const res = (await adminApi.setWaitlistStatus(row.id, next)) as { data: WaitlistRow };
      patchRow(row.id, res.data ?? { status: next });
      onStatusChanged();
    } catch (err: unknown) {
      patchRow(row.id, { status: previous });
      setStatusError(
        `Could not change ${row.email} to ${next}: ${getErrorMessage(err, 'the change was not saved')}`,
      );
    } finally {
      setSaving((current) => {
        const copy = new Set(current);
        copy.delete(row.id);
        return copy;
      });
    }
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const counts = summary?.waitlist;

  const statusTabs: Array<{ value: string; label: string; count: number | null }> = [
    { value: '', label: 'All', count: counts ? counts.total : null },
    ...WAITLIST_STATUSES.map((status) => ({
      value: status,
      label: label(status),
      count: counts ? (counts.byStatus[status] ?? 0) : null,
    })),
  ];

  return (
    <>
      <div
        className="dash-bar flex flex-wrap items-center gap-x-5 gap-y-1"
        role="group"
        aria-label="Waitlist status"
      >
        {statusTabs.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            aria-pressed={query.status === tab.value}
            onClick={() => onQuery({ status: tab.value })}
            className="dash-btn dash-btn--ghost dash-btn--sm"
          >
            {tab.label}
            {tab.count !== null && (
              <span className="dash-mono text-xs font-normal">{tab.count.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>

      <div className="dash-bar flex flex-wrap items-end gap-3" role="search">
        <DebouncedInput
          label="Search"
          value={query.q}
          onCommit={(q) => onQuery({ q })}
          placeholder="Email or company"
          className="min-w-[200px] flex-1"
        />
        <TagFilter
          subject="waitlist"
          value={query.tag}
          version={version}
          onChange={(tag) => onQuery({ tag })}
        />
        <DebouncedInput
          label="Country"
          value={query.country}
          onCommit={(country) => onQuery({ country })}
          placeholder="IN"
          maxLength={2}
          transform={upper}
          accept={isCountryCode}
          className="w-20"
        />
        <ExportButton kind="waitlist" params={filters} columns={EXPORT_COLUMNS} />
      </div>

      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="dash-btn dash-btn--secondary dash-btn--sm"
            >
              Retry
            </button>
          }
        >
          {error}
        </Notice>
      )}
      {statusError && (
        <Notice tone="bad" role="alert">
          {statusError}
        </Notice>
      )}

      <section aria-label="Waitlist" aria-busy={loading} className="dash-panel dash-panel--flush">
        {error && !data ? null : loading && !data ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]" role="status">
            Loading the waitlist.
          </p>
        ) : !error && rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">
            No waitlist signups match these filters.
          </p>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Waitlist table, scrolls horizontally"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            <table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Account</th>
                  <th>Source</th>
                  <th>Joined</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[280px] break-words text-[var(--ink)]">
                      {row.email}
                      <TagChips tags={row.tags ?? []} />
                    </td>
                    <td className="min-w-[14ch]">{row.company || '-'}</td>
                    <td>{row.country || '-'}</td>
                    <td>
                      <select
                        aria-label={`Status for ${row.email}`}
                        value={row.status}
                        disabled={saving.has(row.id)}
                        onChange={(event) =>
                          changeStatus(row, event.target.value as WaitlistStatus)
                        }
                        className="px-2 py-1 text-sm"
                      >
                        {WAITLIST_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {row.registeredUserId ? (
                        <button
                          type="button"
                          className="people-link"
                          aria-label={`Registered: open ${row.email}`}
                          onClick={() => onOpen(row.registeredUserId!)}
                        >
                          Registered
                        </button>
                      ) : (
                        <span className="whitespace-nowrap text-[var(--muted)]">
                          Not registered
                        </span>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {label(row.source.replace(/_/g, ' '))}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      <time
                        dateTime={row.createdAt}
                        title={new Date(row.createdAt).toLocaleString()}
                      >
                        {formatDay(row.createdAt)}
                      </time>
                      <span className="block text-[var(--muted)]">
                        {formatRelativeTime(row.createdAt)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Notes for ${row.email}`}
                        onClick={() => setNotesRow(row)}
                        className="dash-btn dash-btn--secondary dash-btn--sm"
                      >
                        Notes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Pager
        page={query.page}
        limit={PAGE_SIZE}
        total={total}
        busy={loading}
        onPage={(page) => onQuery({ page })}
      />

      <WaitlistDetailDialog row={notesRow} onClose={closeNotes} onTagsChanged={onTagsChanged} />
    </>
  );
}
