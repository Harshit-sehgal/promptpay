'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { ledgerApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface LedgerEntry {
  id: string;
  amountMinor: number;
  currency: string;
  entryType: string;
  description?: string;
  createdAt: string;
}

interface BillingData {
  balance: number;
  balanceMinor: number;
  currency: string;
  entries: LedgerEntry[];
}

export default function AdvertiserBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      ledgerApi.getBalance(),
      ledgerApi.getHistory({ page: 1, limit: 30 }),
    ])
      .then(([balRes, histRes]) => {
        // LedgerBalanceResponse gives nested {available, pending, total, paidOut}.
        // Use `available` as the advertiser's usable balance.
        const avail = balRes.data.available;
        const balanceMinor = avail.amountMinor ?? 0;
        setData({
          balance: balanceMinor / 100,
          balanceMinor,
          currency: avail.currency ?? 'USD',
          entries: histRes.data.entries || [],
        });
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load billing')))
      .finally(() => setLoading(false));
  }, []);

  const totalDeposits = data?.entries
    .filter((e) => e.entryType === 'deposit')
    .reduce((sum, e) => sum + e.amountMinor, 0) || 0;

  const totalCharges = data?.entries
    .filter((e) => e.entryType === 'charge' || e.entryType === 'impression_charge')
    .reduce((sum, e) => sum + e.amountMinor, 0) || 0;

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Billing</h1>
          <p className="text-ink-300 text-sm">
            Deposit history, charges, and account balance
          </p>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <StatCard
                label="Account balance"
                value={formatCurrency(data.balanceMinor)}
                valueColor="text-brand-500"
              />
              <StatCard
                label="Total deposits"
                value={formatCurrency(totalDeposits)}
              />
              <StatCard
                label="Total charges"
                value={formatCurrency(totalCharges)}
              />
            </div>

            {/* Top up notice */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <h2 className="text-white font-semibold mb-2">Top up your account</h2>
              <p className="text-ink-300 text-sm mb-4">
                Deposits are processed via Stripe. Your balance is used to fund active campaigns.
                Campaigns with insufficient balance are automatically paused.
              </p>
              <button
                className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
                onClick={() => {}}
              >
                Add funds via Stripe
              </button>
            </div>

            {/* Transaction history */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-ink-600/30">
                <h2 className="text-white font-semibold">Transaction history</h2>
              </div>
              {data.entries.length === 0 ? (
                <div className="text-ink-400 text-sm py-12 text-center">
                  No transactions yet. Add funds to start running campaigns.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-ink-700/50 border-b border-ink-600/30">
                    <tr>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Date</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Description</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-600/20">
                    {data.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-ink-700/30 transition-colors">
                        <td className="px-4 py-3 text-ink-300 text-xs">
                          {formatRelativeTime(entry.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-white">
                          {entry.description || entry.entryType.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              entry.entryType === 'deposit'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-ink-600 text-ink-200'
                            }`}
                          >
                            {entry.entryType.replace('_', ' ')}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono ${
                            entry.entryType === 'deposit' ? 'text-emerald-400' : 'text-ink-300'
                          }`}
                        >
                          {entry.entryType === 'deposit' ? '+' : '−'}
                          {formatCurrency(entry.amountMinor, entry.currency)}
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
