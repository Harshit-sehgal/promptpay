'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, type Tone } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { ledgerApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

interface Breakdown {
  earningsLedger: {
    balanceMinor: number;
    pendingMinor: number;
    confirmedMinor: number;
    byCurrency?: Record<string, number>;
    pendingByCurrency?: Record<string, number>;
  };
  advertiserLedger: { balanceMinor: number; byCurrency?: Record<string, number> };
  platformLedger: {
    revenueMinor: number;
    reserveMinor: number;
    revenueByCurrency?: Record<string, number>;
    reserveByCurrency?: Record<string, number>;
  };
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

interface LedgerHistoryResponse {
  entries?: LedgerEntry[];
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
      .then(([bdRes, histRes]: [{ data: Breakdown }, { data: LedgerHistoryResponse }]) => {
        setBreakdown(bdRes.data);
        setEntries(histRes.data.entries || []);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load ledger')))
      .finally(() => setLoading(false));
  }, [ledgerKind]);

  const kindTone: Record<LedgerEntry['ledgerKind'], Tone> = {
    earnings: 'ok',
    advertiser: 'neutral',
    platform: 'neutral',
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Ledger & revenue"
        lede="All three ledgers — earnings, advertiser balance, platform revenue"
      />

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {breakdown && (
        <>
          <div className="dash-grid dash-grid--4">
            <StatCard
              label="Confirmed earnings (payable)"
              value={formatCurrencyBreakdown(
                breakdown.earningsLedger.byCurrency ?? {
                  USD: breakdown.earningsLedger.confirmedMinor,
                },
              )}
            />
            <StatCard
              label="Pending earnings"
              value={formatCurrencyBreakdown(
                breakdown.earningsLedger.pendingByCurrency ?? {
                  USD: breakdown.earningsLedger.pendingMinor,
                },
              )}
            />
            <StatCard
              label="Advertiser balances"
              value={formatCurrencyBreakdown(
                breakdown.advertiserLedger.byCurrency ?? {
                  USD: breakdown.advertiserLedger.balanceMinor,
                },
              )}
            />
            <StatCard
              label="Platform revenue"
              value={formatCurrencyBreakdown(
                breakdown.platformLedger.revenueByCurrency ?? {
                  USD: breakdown.platformLedger.revenueMinor,
                },
              )}
              subtitle={`Reserve: ${formatCurrencyBreakdown(
                breakdown.platformLedger.reserveByCurrency ?? {
                  USD: breakdown.platformLedger.reserveMinor,
                },
              )}`}
            />
          </div>

          <Panel label="Revenue split">
            <PanelHeader title="Revenue split" />
            <div className="dash-grid dash-grid--3">
              <div>
                <p className="dash-eyebrow">User share (60-80%)</p>
                <p className="dash-mono text-lg text-[var(--ink)]">
                  {formatCurrencyBreakdown(
                    breakdown.earningsLedger.byCurrency ?? {
                      USD: breakdown.earningsLedger.confirmedMinor,
                    },
                  )}
                </p>
              </div>
              <div>
                <p className="dash-eyebrow">Platform (30-10%)</p>
                <p className="dash-mono text-lg text-[var(--ink)]">
                  {formatCurrencyBreakdown(
                    breakdown.platformLedger.revenueByCurrency ?? {
                      USD: breakdown.platformLedger.revenueMinor,
                    },
                  )}
                </p>
              </div>
              <div>
                <p className="dash-eyebrow">Reserve (10%)</p>
                <p className="dash-mono text-lg text-[var(--ink)]">
                  {formatCurrencyBreakdown(
                    breakdown.platformLedger.reserveByCurrency ?? {
                      USD: breakdown.platformLedger.reserveMinor,
                    },
                  )}
                </p>
              </div>
            </div>
          </Panel>

          {/* Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Ledger:</span>
            {['', 'earnings', 'advertiser', 'platform'].map((k) => (
              <button
                key={k || 'all'}
                onClick={() => setLedgerKind(k)}
                className={`dash-btn dash-btn--sm ${
                  ledgerKind === k ? 'dash-btn--primary' : 'dash-btn--glass'
                }`}
              >
                {k || 'All'}
              </button>
            ))}
          </div>

          {/* Entries */}
          <Panel label="Ledger entries" flush>
            {entries.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--muted)]">
                No ledger entries.
              </div>
            ) : (
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Ledger entries table, scrolls horizontally"
              >
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr>
                      <th className="text-left">When</th>
                      <th className="text-left">Ledger</th>
                      <th className="text-left">Type</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td>{formatRelativeTime(e.createdAt)}</td>
                        <td>
                          <Pill tone={kindTone[e.ledgerKind]}>{e.ledgerKind}</Pill>
                        </td>
                        <td className="capitalize">{e.entryType.replace('_', ' ')}</td>
                        <td className="dash-mono text-right">
                          {formatCurrency(e.amountMinor, e.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
