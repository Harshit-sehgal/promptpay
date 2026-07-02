'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge, StatCard } from '@/components';
import { ledgerApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface EarningsEntry {
  id: string;
  userId: string;
  status: string;
  amountMinor: number;
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

  useEffect(() => {
    setLoading(true);
    ledgerApi.getHistory({ status: statusFilter || undefined, page: 1, limit: 50 })
      .then((res: any) => setData(res.data))
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load earnings'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const totalsByStatus = data?.entries.reduce<Record<string, number>>((acc, e) => {
    if (!acc[e.status]) acc[e.status] = 0;
    acc[e.status] += e.amountMinor;
    return acc;
  }, {}) || {};

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Earnings ledger</h1>
        <p className="text-surface-500 text-[15px]">Every earning entry with status and availability date</p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Estimated"
          value={formatCurrency(totalsByStatus.estimated || 0)}
          subtitle="Pending hold period"
          variant="light"
        />
        <StatCard
          label="Pending"
          value={formatCurrency(totalsByStatus.pending || 0)}
          subtitle="Awaiting confirmation"
          valueColor="text-amber-600"
          variant="light"
        />
        <StatCard
          label="Confirmed"
          value={formatCurrency(totalsByStatus.confirmed || 0)}
          valueColor="text-emerald-600"
          subtitle="Available for payout"
          variant="light"
        />
        <StatCard
          label="Held"
          value={formatCurrency(totalsByStatus.held || 0)}
          valueColor="text-rose-600"
          subtitle="Under review"
          variant="light"
        />
      </div>

      {/* Filter */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-surface-500 text-sm font-medium mr-1">Filter:</span>
        {['', 'estimated', 'pending', 'confirmed', 'held', 'paid', 'reversed'].map(
          (status) => (
            <button
              key={status || 'all'}
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                statusFilter === status
                  ? 'bg-brand-50 border-brand-200 text-brand-600 font-bold'
                  : 'bg-surface-50 border-surface-200/80 text-surface-500 hover:bg-surface-100/50 hover:text-surface-900'
              }`}
            >
              {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
            </button>
          ),
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <div className="bg-white border border-surface-200/80 rounded-2xl shadow-sm overflow-hidden">
          {data.entries.length === 0 ? (
            <div className="text-surface-400 text-sm py-16 text-center">
              No earnings yet. Install the WaitLayer VS Code extension to start tracking wait
              states.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-50/50 border-b border-surface-200/80">
                <tr>
                  <th className="text-left px-5 py-3.5 text-surface-500 font-semibold tracking-tight">Date</th>
                  <th className="text-left px-5 py-3.5 text-surface-500 font-semibold tracking-tight">Description</th>
                  <th className="text-left px-5 py-3.5 text-surface-500 font-semibold tracking-tight">Status</th>
                  <th className="text-right px-5 py-3.5 text-surface-500 font-semibold tracking-tight">Amount</th>
                  <th className="text-right px-5 py-3.5 text-surface-500 font-semibold tracking-tight">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-surface-50/30 transition-colors">
                    <td className="px-5 py-3.5 text-surface-500">{formatRelativeTime(entry.createdAt)}</td>
                    <td className="px-5 py-3.5 text-surface-900 font-medium">
                      {entry.description || `${entry.entryType} entry`}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-surface-900 font-semibold">
                      {formatCurrency(entry.amountMinor, entry.currency)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-surface-500 text-xs">
                      {entry.availableAt
                        ? formatRelativeTime(entry.availableAt)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
