'use client';

import type { AxiosResponse } from 'axios';
import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { ledgerApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

interface EarningsEntry {
  id: string;
  userId: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  entryType: string;
  description?: string;
  createdAt: string;
  availableAt?: string;
}

interface EarningsResponse {
  entries: EarningsEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function DevEarningsPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    (
      ledgerApi.getHistory({ status: statusFilter || undefined, page, limit }) as Promise<
        AxiosResponse<EarningsResponse>
      >
    )
      .then((res) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load earnings')))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const totalsByStatus =
    data?.entries.reduce<Record<string, Record<string, bigint>>>((acc, e) => {
      if (!acc[e.status]) acc[e.status] = {};
      acc[e.status][e.currency] = (acc[e.status][e.currency] ?? 0n) + e.amountMinor;
      return acc;
    }, {}) || {};

  return (
    <>
      <PageHeader
        title="Earnings ledger"
        lede="Every earning entry with status and availability date"
      />

      {/* Status summary */}
      <div className="dash-grid dash-grid--4">
        <Panel label="Shown estimated">
          <Stat
            label="Shown estimated"
            value={formatCurrencyBreakdown(totalsByStatus.estimated || {})}
            detail="Pending hold period"
          />
        </Panel>
        <Panel label="Shown pending">
          <Stat
            label="Shown pending"
            value={formatCurrencyBreakdown(totalsByStatus.pending || {})}
            detail="Awaiting confirmation"
          />
        </Panel>
        <Panel label="Shown confirmed">
          <Stat
            label="Shown confirmed"
            value={formatCurrencyBreakdown(totalsByStatus.confirmed || {})}
            detail="Available for payout"
          />
        </Panel>
        <Panel label="Shown held">
          <Stat
            label="Shown held"
            value={formatCurrencyBreakdown(totalsByStatus.held || {})}
            detail="Under review"
          />
        </Panel>
      </div>
      <p className="-mt-3 text-xs text-[var(--muted)]">
        Status totals reflect the current page of ledger entries.
      </p>

      {/* Filter */}
      <div className="dash-bar flex flex-wrap items-center gap-2">
        <span className="mr-1.5 text-sm font-medium text-[var(--muted)]">Filter:</span>
        {['', 'estimated', 'pending', 'confirmed', 'held', 'paid', 'reversed'].map((status) => (
          <button
            key={status || 'all'}
            onClick={() => {
              setStatusFilter(status);
              setPage(1);
            }}
            className={`dash-btn dash-btn--sm ${
              statusFilter === status ? 'dash-btn--primary' : 'dash-btn--secondary'
            }`}
          >
            {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {data && (
        <Panel label="Earnings ledger" flush>
          {data.entries.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted)]">
              No earnings yet. Install the Ateva VS Code extension to start tracking wait states.
            </div>
          ) : (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Earnings ledger table, scrolls horizontally"
            >
              <table className="min-w-[760px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatRelativeTime(entry.createdAt)}</td>
                      <td className="font-medium text-[var(--ink)]">
                        {entry.description || `${entry.entryType} entry`}
                      </td>
                      <td>
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="dash-mono text-right text-[var(--ink)]">
                        {formatCurrency(entry.amountMinor, entry.currency)}
                      </td>
                      <td className="text-right text-xs">
                        {entry.availableAt ? formatRelativeTime(entry.availableAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 border-t border-[var(--hair)] px-[22px] py-4">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
                className="dash-btn dash-btn--secondary dash-btn--sm"
              >
                Previous
              </button>
              <span className="text-xs text-[var(--muted)]">
                Page {data.page} of {data.totalPages} · {data.total} entries
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
                disabled={page >= data.totalPages || loading}
                className="dash-btn dash-btn--secondary dash-btn--sm"
              >
                Next
              </button>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
