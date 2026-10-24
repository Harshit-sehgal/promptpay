'use client';

import { useEffect, useMemo, useState } from 'react';
import { Notice, Pill } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, type PeopleUsersParams } from '@/lib/api/services';
import type { CsvColumn } from '@/lib/csv';
import { formatRelativeTime } from '@/lib/format';

import { DebouncedInput, formatDay, Pager, SelectFilter, userStatusTone } from './controls';
import { ExportButton } from './export-button';
import { type ListResponse, PAGE_SIZE, type PeopleQuery, type PersonRow } from './types';

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'developer', label: 'Developer' },
  { value: 'advertiser', label: 'Advertiser' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super admin' },
  { value: 'support', label: 'Support' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'banned', label: 'Banned' },
  { value: 'deleted', label: 'Deleted' },
];

const VERIFIED_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'email', label: 'Email verified' },
  { value: 'unverified', label: 'Not verified' },
];

const isCountryCode = (value: string) => value.length === 0 || value.length === 2;
const upper = (value: string) => value.toUpperCase();

export function verifiedLabel(row: PersonRow): string {
  const parts = [
    row.emailVerified && 'Email',
    row.googleVerified && 'Google',
    row.githubVerified && 'GitHub',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'None';
}

const EXPORT_COLUMNS: CsvColumn<PersonRow>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Email', value: (r) => r.email },
  { header: 'Name', value: (r) => r.name },
  { header: 'Role', value: (r) => r.role },
  { header: 'Status', value: (r) => r.status },
  { header: 'Trust level', value: (r) => r.trustLevel },
  { header: 'Country', value: (r) => r.country },
  { header: 'Email verified', value: (r) => r.emailVerified },
  { header: 'Google linked', value: (r) => r.googleVerified },
  { header: 'GitHub linked', value: (r) => r.githubVerified },
  { header: 'Two-factor', value: (r) => r.twoFactorEnabled },
  { header: 'Company', value: (r) => r.companyName },
  { header: 'Devices', value: (r) => r.deviceCount },
  { header: 'Last seen', value: (r) => r.lastSeenAt },
  { header: 'Joined', value: (r) => r.createdAt },
];

export function RegisteredTab({
  query,
  onQuery,
  onOpen,
}: {
  query: PeopleQuery;
  onQuery: (patch: Partial<PeopleQuery>) => void;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<ListResponse<PersonRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const filters = useMemo<PeopleUsersParams>(
    () => ({
      ...(query.q ? { search: query.q } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.country ? { country: query.country } : {}),
      ...(query.verified ? { verified: query.verified as 'email' | 'unverified' } : {}),
    }),
    [query.q, query.role, query.status, query.country, query.verified],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi
      .getPeopleUsers({ ...filters, page: query.page, limit: PAGE_SIZE })
      .then((res: { data: ListResponse<PersonRow> }) => {
        if (!cancelled) setData(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load registered users'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, query.page, attempt]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="dash-bar flex flex-wrap items-end gap-3" role="search">
        <DebouncedInput
          label="Search"
          value={query.q}
          onCommit={(q) => onQuery({ q })}
          placeholder="Email or name"
          className="min-w-[200px] flex-1"
        />
        <SelectFilter
          label="Role"
          value={query.role}
          onChange={(role) => onQuery({ role })}
          options={ROLE_OPTIONS}
        />
        <SelectFilter
          label="Status"
          value={query.status}
          onChange={(status) => onQuery({ status })}
          options={STATUS_OPTIONS}
        />
        <SelectFilter
          label="Verification"
          value={query.verified}
          onChange={(verified) => onQuery({ verified })}
          options={VERIFIED_OPTIONS}
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
        <ExportButton kind="users" params={filters} columns={EXPORT_COLUMNS} />
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

      <section
        aria-label="Registered users"
        aria-busy={loading}
        className="dash-panel dash-panel--flush"
      >
        {error && !data ? null : loading && !data ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]" role="status">
            Loading registered users.
          </p>
        ) : !error && rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">
            No registered users match these filters.
          </p>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Registered users table, scrolls horizontally"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            <table className="min-w-[960px]">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Country</th>
                  <th>Verified</th>
                  <th>2FA</th>
                  <th>Devices</th>
                  <th>Last seen</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[280px] break-words">
                      <button type="button" className="people-link" onClick={() => onOpen(row.id)}>
                        {row.name || row.email}
                      </button>
                      <p className="text-xs text-[var(--muted)]">
                        {row.name ? row.email : null}
                        {row.name && row.companyName ? ', ' : null}
                        {row.companyName}
                      </p>
                    </td>
                    <td className="capitalize">{row.role.replace(/_/g, ' ')}</td>
                    <td>
                      <Pill tone={userStatusTone(row.status)}>{row.status.replace(/_/g, ' ')}</Pill>
                    </td>
                    <td>{row.country || '-'}</td>
                    <td className="whitespace-nowrap">{verifiedLabel(row)}</td>
                    <td>{row.twoFactorEnabled ? 'On' : 'Off'}</td>
                    <td className="tabular-nums">{row.deviceCount}</td>
                    <td className="text-xs whitespace-nowrap">
                      {row.lastSeenAt ? (
                        <time
                          dateTime={row.lastSeenAt}
                          title={new Date(row.lastSeenAt).toLocaleString()}
                        >
                          {formatRelativeTime(row.lastSeenAt)}
                        </time>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      <time dateTime={row.createdAt}>{formatDay(row.createdAt)}</time>
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
    </>
  );
}
