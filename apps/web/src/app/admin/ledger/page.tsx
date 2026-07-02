'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { ledgerApi, adminApi } from '@/lib/api/services';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/format';

interface Breakdown {
  earningsLedger: { balanceMinor: number; pendingMinor: number; confirmedMinor: number };
  advertiserLedger: { balanceMinor: number };
  platformLedger: { revenueMinor: number; reserveMinor: number };
}

interface LedgerEntry {
  id: string;
  ledgerKind: 'earnings' | 'advertiser' | 'platform';
  amountMinor: number;
  currency: string;
  entryType: string;
  description?: string;
  createdAt: string;
}

export default function AdminLedgerPage() {
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerKind, setLedgerKind] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      ledgerApi.getAdminBreakdown(),
      ledgerApi.getAdminHistory({ ledgerKind: ledgerKind || undefined, page: 1, limit: 50 }),
    ])
      .then(([bdRes, histRes]: any) => {
        setBreakdown(bdRes.data);
        setEntries(histRes.data.entries || []);
      })
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load ledger'))
      .finally(() => setLoading(false));
  }, [ledgerKind]);

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Ledger & revenue</h1>
          <p className="text-ink-300 text-sm">All three ledgers — earnings, advertiser balance, platform revenue</p>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {breakdown && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <StatCard
                label="Confirmed earnings (payable)"
                value={formatCurrency(breakdown.earningsLedger.confirmedMinor)}
                valueColor="text-emerald-400"
              />
              <StatCard
                label="Pending earnings"
                value={formatCurrency(breakdown.earningsLedger.pendingMinor)}
              />
              <StatCard
                label="Advertiser balances"
                value={formatCurrency(breakdown.advertiserLedger.balanceMinor)}
              />
              <StatCard
                label="Platform revenue"
                value={formatCurrency(breakdown.platformLedger.revenueMinor)}
                valueColor="text-brand-500"
                subtitle={`Reserve: ${formatCurrency(breakdown.platformLedger.reserveMinor)}`}
              />
            </div>

            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-6">
              <h2 className="text-white font-semibold mb-4">Revenue split</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-ink-400 text-xs uppercase">User share (60-80%)</p>
                  <p className="text-emerald-400 font-mono text-lg">
                    {formatCurrency(breakdown.earningsLedger.confirmedMinor + breakdown.earningsLedger.pendingMinor)}
                  </p>
                </div>
                <div>
                  <p className="text-ink-400 text-xs uppercase">Platform (30-10%)</p>
                  <p className="text-brand-500 font-mono text-lg">
                    {formatCurrency(breakdown.platformLedger.revenueMinor)}
                  </p>
                </div>
                <div>
                  <p className="text-ink-400 text-xs uppercase">Reserve (10%)</p>
                  <p className="text-amber-400 font-mono text-lg">
                    {formatCurrency(breakdown.platformLedger.reserveMinor)}
                  </p>
                </div>
              </div>
            </div>

            {/* Filter */}
            <div className="mb-6 flex items-center gap-2">
              <span className="text-ink-400 text-sm">Ledger:</span>
              {['', 'earnings', 'advertiser', 'platform'].map((k) => (
                <button
                  key={k || 'all'}
                  onClick={() => setLedgerKind(k)}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    ledgerKind === k
                      ? 'bg-brand-500 text-white'
                      : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                  }`}
                >
                  {k || 'All'}
                </button>
              ))}
            </div>

            {/* Entries */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
              {entries.length === 0 ? (
                <div className="text-ink-400 text-sm py-12 text-center">No ledger entries.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-ink-700/50 border-b border-ink-600/30">
                    <tr>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">When</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Ledger</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-600/20">
                    {entries.map((e) => (
                      <tr key={e.id} className="hover:bg-ink-700/30 transition-colors">
                        <td className="px-4 py-3 text-ink-300 text-xs">
                          {formatRelativeTime(e.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded ${
                              e.ledgerKind === 'earnings'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : e.ledgerKind === 'advertiser'
                                ? 'bg-purple-500/20 text-purple-400'
                                : 'bg-brand-500/20 text-brand-500'
                            }`}
                          >
                            {e.ledgerKind}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white text-xs capitalize">
                          {e.entryType.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-white">
                          {formatCurrency(e.amountMinor, e.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      
</>
);
}
