'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge, StatCard } from '@/components';
import { developerApi, ledgerApi } from '@/lib/api/services';
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
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Earnings ledger</h1>
          <p className="text-ink-300 text-sm">Every earning entry with status and availability date</p>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Estimated"
            value={formatCurrency(totalsByStatus.estimated || 0)}
            subtitle="Pending hold period"
          />
          <StatCard
            label="Pending"
            value={formatCurrency(totalsByStatus.pending || 0)}
            subtitle="Awaiting confirmation"
          />
          <StatCard
            label="Confirmed"
            value={formatCurrency(totalsByStatus.confirmed || 0)}
            valueColor="text-emerald-400"
            subtitle="Available for payout"
          />
          <StatCard
            label="Held"
            value={formatCurrency(totalsByStatus.held || 0)}
            valueColor="text-amber-400"
            subtitle="Under review"
          />
        </div>

        {/* Filter */}
        <div className="mb-6 flex items-center gap-2">
          <span className="text-ink-400 text-sm">Filter:</span>
          {['', 'estimated', 'pending', 'confirmed', 'held', 'paid', 'reversed'].map(
            (status) => (
              <button
                key={status || 'all'}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                  statusFilter === status
                    ? 'bg-brand-500 text-white'
                    : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                }`}
              >
                {status || 'All'}
              </button>
            ),
          )}
        </div>

        {loading && <LoadingSpinner />}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {data && (
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
            {data.entries.length === 0 ? (
              <div className="text-ink-400 text-sm py-12 text-center">
                No earnings yet. Install the WaitLayer VS Code extension to start tracking wait
                states.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-ink-700/50 border-b border-ink-600/30">
                  <tr>
                    <th className="text-left px-4 py-3 text-ink-300 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-ink-300 font-medium">Description</th>
                    <th className="text-left px-4 py-3 text-ink-300 font-medium">Status</th>
                    <th className="text-right px-4 py-3 text-ink-300 font-medium">Amount</th>
                    <th className="text-right px-4 py-3 text-ink-300 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-600/20">
                  {data.entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-ink-700/30 transition-colors">
                      <td className="px-4 py-3 text-ink-300">{formatRelativeTime(entry.createdAt)}</td>
                      <td className="px-4 py-3 text-white">
                        {entry.description || `${entry.entryType} entry`}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white">
                        {formatCurrency(entry.amountMinor, entry.currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-400 text-xs">
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
      
</>
);
}
