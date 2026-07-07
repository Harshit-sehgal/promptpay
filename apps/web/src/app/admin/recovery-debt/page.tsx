'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

type RecoveryDebtCaseStatus = 'open' | 'in_collections' | 'recovered' | 'written_off' | 'closed';

interface RecoveryDebtCase {
  id: string;
  userId: string;
  status: RecoveryDebtCaseStatus;
  amountMinor: number;
  currency: string;
  externalReference?: string | null;
  note?: string | null;
  updatedAt?: string;
}

interface RecoveryDebtRow {
  userId: string;
  currency: string;
  confirmedDebitMinor: number;
  confirmedCreditMinor: number;
  outstandingDebtMinor: number;
  recoveryDebitEntryCount: number;
  user?: {
    email?: string | null;
    name?: string | null;
    status?: string;
    trustLevel?: string;
  } | null;
  latestCase?: RecoveryDebtCase | null;
}

interface RecoveryDebtResponse {
  items: RecoveryDebtRow[];
  total: number;
  page: number;
  limit: number;
}

type ActionState =
  | { mode: 'open'; row: RecoveryDebtRow; status: 'open' | 'in_collections' }
  | { mode: 'resolve'; row: RecoveryDebtRow; caseId: string; status: 'recovered' | 'written_off' | 'closed' };

const ACTIVE_CASE_STATUSES = new Set<RecoveryDebtCaseStatus>(['open', 'in_collections']);

function caseBadgeClass(status?: RecoveryDebtCaseStatus) {
  switch (status) {
    case 'open':
      return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
    case 'in_collections':
      return 'bg-red-500/10 text-red-300 border-red-500/20';
    case 'recovered':
      return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
    case 'written_off':
      return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/20';
    case 'closed':
      return 'bg-blue-500/10 text-blue-300 border-blue-500/20';
    default:
      return 'bg-ink-700 text-ink-300 border-ink-600';
  }
}

function formatStatus(status?: string | null) {
  return status ? status.replace(/_/g, ' ') : 'no case';
}

export default function AdminRecoveryDebtPage() {
  const [data, setData] = useState<RecoveryDebtResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [minAmountMinor, setMinAmountMinor] = useState('1');
  const [currency, setCurrency] = useState('');
  const [action, setAction] = useState<ActionState | null>(null);
  const [externalReference, setExternalReference] = useState('');
  const [note, setNote] = useState('');
  const [processing, setProcessing] = useState(false);

  const params = useMemo(() => ({
    page,
    limit: 25,
    minAmountMinor: Number(minAmountMinor) || 1,
    currency: currency.trim() || undefined,
  }), [currency, minAmountMinor, page]);

  const fetchDebt = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi.getRecoveryDebtCases(params)
      .then((res: { data: RecoveryDebtResponse }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load recovery debt')))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    fetchDebt();
  }, [fetchDebt]);

  const openAction = (next: ActionState) => {
    setAction(next);
    setExternalReference(next.row.latestCase?.externalReference || '');
    setNote(next.row.latestCase?.note || '');
  };

  const submitAction = async () => {
    if (!action) return;
    setProcessing(true);
    setError(null);
    try {
      if (action.mode === 'open') {
        await adminApi.openRecoveryDebtCase(action.row.userId, {
          status: action.status,
          currency: action.row.currency,
          externalReference: externalReference || undefined,
          note: note || undefined,
        });
      } else {
        await adminApi.resolveRecoveryDebtCase(action.caseId, {
          status: action.status,
          externalReference: externalReference || undefined,
          note: note || undefined,
        });
      }
      setAction(null);
      setExternalReference('');
      setNote('');
      fetchDebt();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Recovery debt action failed'));
    } finally {
      setProcessing(false);
    }
  };

  const items = data?.items || [];
  const totalOutstanding = items.reduce((sum, row) => sum + row.outstandingDebtMinor, 0);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Recovery debt</h1>
        <p className="text-ink-300 text-sm">
          Track paid-fraud recovery debt that has not been netted from future earnings.
        </p>
      </div>

      <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <p className="text-ink-400 text-xs uppercase tracking-wider">Rows shown</p>
            <p className="text-3xl font-bold text-white">{items.length}</p>
          </div>
          <div>
            <p className="text-ink-400 text-xs uppercase tracking-wider">Total matching</p>
            <p className="text-3xl font-bold text-white">{data?.total ?? 0}</p>
          </div>
          <div>
            <p className="text-ink-400 text-xs uppercase tracking-wider">Shown outstanding</p>
            <p className="text-3xl font-bold text-red-300 font-mono">{formatCurrency(totalOutstanding)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-ink-400 text-xs uppercase tracking-wider">Min cents</span>
              <input
                value={minAmountMinor}
                onChange={(e) => {
                  setPage(1);
                  setMinAmountMinor(e.target.value);
                }}
                inputMode="numeric"
                className="mt-2 w-full bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </label>
            <label className="block">
              <span className="text-ink-400 text-xs uppercase tracking-wider">Currency</span>
              <input
                value={currency}
                onChange={(e) => {
                  setPage(1);
                  setCurrency(e.target.value.toUpperCase());
                }}
                maxLength={3}
                placeholder="ALL"
                className="mt-2 w-full bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-2 text-white text-sm uppercase focus:outline-none focus:border-brand-500"
              />
            </label>
          </div>
        </div>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && items.length === 0 ? (
        <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
          <p className="text-ink-400 text-sm">No outstanding recovery debt matches these filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => {
            const latestCase = row.latestCase;
            const activeCase = latestCase && ACTIVE_CASE_STATUSES.has(latestCase.status);
            return (
              <div key={`${row.userId}:${row.currency}`} className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-white font-medium truncate">
                        {row.user?.email || row.userId}
                      </p>
                      <span className={`border rounded-full px-2 py-0.5 text-xs capitalize ${caseBadgeClass(latestCase?.status)}`}>
                        {formatStatus(latestCase?.status)}
                      </span>
                      <span className="text-ink-400 text-xs uppercase">{row.currency}</span>
                    </div>
                    <p className="text-ink-400 text-xs">
                      {row.recoveryDebitEntryCount} recovery debit entries
                      <span className="mx-2">·</span>
                      User status {row.user?.status || 'unknown'}
                      <span className="mx-2">·</span>
                      Trust {formatStatus(row.user?.trustLevel)}
                    </p>
                    {latestCase && (
                      <p className="text-ink-500 text-xs mt-1">
                        Case {latestCase.id}
                        {latestCase.updatedAt ? ` · updated ${formatRelativeTime(latestCase.updatedAt)}` : ''}
                        {latestCase.externalReference ? ` · ${latestCase.externalReference}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4 min-w-[320px]">
                    <div>
                      <p className="text-ink-500 text-xs uppercase tracking-wider">Debits</p>
                      <p className="text-white font-mono">{formatCurrency(row.confirmedDebitMinor, row.currency)}</p>
                    </div>
                    <div>
                      <p className="text-ink-500 text-xs uppercase tracking-wider">Credits</p>
                      <p className="text-white font-mono">{formatCurrency(row.confirmedCreditMinor, row.currency)}</p>
                    </div>
                    <div>
                      <p className="text-ink-500 text-xs uppercase tracking-wider">Outstanding</p>
                      <p className="text-red-300 font-mono font-semibold">{formatCurrency(row.outstandingDebtMinor, row.currency)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <button
                      onClick={() => openAction({ mode: 'open', row, status: activeCase ? latestCase.status as 'open' | 'in_collections' : 'open' })}
                      className="bg-ink-700 hover:bg-ink-600 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {activeCase ? 'Update case' : 'Open case'}
                    </button>
                    <button
                      onClick={() => openAction({ mode: 'open', row, status: 'in_collections' })}
                      className="bg-red-500/15 hover:bg-red-500/25 text-red-200 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      Collections
                    </button>
                    {activeCase && (
                      <>
                        <button
                          onClick={() => openAction({ mode: 'resolve', row, caseId: latestCase.id, status: 'recovered' })}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                        >
                          Recovered
                        </button>
                        <button
                          onClick={() => openAction({ mode: 'resolve', row, caseId: latestCase.id, status: 'written_off' })}
                          className="bg-ink-700 hover:bg-ink-600 text-zinc-200 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                        >
                          Write off
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
          >
            Previous
          </button>
          <p className="text-ink-400 text-sm">Page {page} of {totalPages}</p>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
          >
            Next
          </button>
        </div>
      )}

      {action && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-lg w-full">
            <h3 className="text-white font-semibold mb-2 capitalize">
              {action.mode === 'open' ? `${formatStatus(action.status)} case` : `${formatStatus(action.status)} case`}
            </h3>
            <p className="text-ink-400 text-sm mb-4">
              {action.row.user?.email || action.row.userId} · {formatCurrency(action.row.outstandingDebtMinor, action.row.currency)} outstanding
            </p>
            <label className="block mb-3">
              <span className="text-ink-400 text-xs uppercase tracking-wider">External reference</span>
              <input
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                maxLength={255}
                className="mt-2 w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
              />
            </label>
            <label className="block mb-5">
              <span className="text-ink-400 text-xs uppercase tracking-wider">Note</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={4}
                className="mt-2 w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
              />
            </label>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setAction(null)}
                className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitAction}
                disabled={processing}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                {processing ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
