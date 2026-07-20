'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface FencedAccountOwner {
  id: string;
  email: string;
}

interface FencedAccountLedgerAllocations {
  count: number;
  totalMinor: bigint;
  currency: string;
}

interface FencedAccount {
  id: string;
  userId: string;
  provider: string;
  destination: string;
  currency: string;
  isVerified: boolean;
  isActive: boolean;
  isFrozen: boolean;
  initiationPayoutId: string | null;
  user: FencedAccountOwner | null;
  reconciliationAttempts: number;
  lastReconciliationAt: string | null;
  escalatedAt: string | null;
  activeFraudFlags: number;
  ledgerAllocations: FencedAccountLedgerAllocations | null;
}

interface FencedAccountListResponse {
  items: FencedAccount[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const MIN_REASON_LENGTH = 5;

export default function AdminFencedPayoutAccountsPage() {
  const [accounts, setAccounts] = useState<FencedAccount[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [releaseFor, setReleaseFor] = useState<FencedAccount | null>(null);
  const [reason, setReason] = useState('');
  const [providerTxId, setProviderTxId] = useState('');
  const [resolution, setResolution] = useState('');
  const [secondApproverId, setSecondApproverId] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchAccounts = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getFencedAccounts({ page, limit })
      .then((res: { data: FencedAccountListResponse }) => {
        setAccounts(res.data.items);
        setTotal(res.data.total);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load fenced accounts')))
      .finally(() => setLoading(false));
  }, [page, limit]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const openRelease = (account: FencedAccount) => {
    setReleaseFor(account);
    setReason('');
    setProviderTxId('');
    setResolution('');
    setSecondApproverId('');
    setError(null);
  };

  const closeRelease = () => {
    setReleaseFor(null);
    setReason('');
    setProviderTxId('');
    setResolution('');
    setSecondApproverId('');
  };

  const handleRelease = async () => {
    if (!releaseFor) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(
        `A release reason of at least ${MIN_REASON_LENGTH} characters is required for the audit trail`,
      );
      return;
    }
    setProcessing(releaseFor.id);
    setError(null);
    try {
      await adminApi.releasePayoutFence(releaseFor.id, {
        reason: reason.trim(),
        providerTxId: providerTxId.trim() || undefined,
        resolution: resolution.trim() || undefined,
        secondApproverId: secondApproverId.trim() || undefined,
      });
      closeRelease();
      fetchAccounts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to release fence'));
    } finally {
      setProcessing(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Fenced payout accounts</h1>
        <p className="text-ink-300 text-sm">
          Payout accounts locked by an in-flight provider-initiation fence. Release only after the
          referenced payout reaches a terminal state (paid / failed / rejected / cancelled).
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && accounts.length === 0 ? (
        <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
          <p className="text-ink-400 text-sm">No fenced payout accounts. All clear.</p>
        </div>
      ) : (
        !loading && (
          <>
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-700/50 border-b border-ink-600/30">
                    <tr>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Owner</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Payout</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Currency</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Exposure</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Fraud flags</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">
                        Ledger allocations
                      </th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">
                        Recon. attempts
                      </th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Last recon.</th>
                      <th className="text-left px-4 py-3 text-ink-300 font-medium">Escalated</th>
                      <th className="text-right px-4 py-3 text-ink-300 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-600/20">
                    {accounts.map((a) => (
                      <tr key={a.id} className="hover:bg-ink-700/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-white text-sm">
                            {a.user?.email ?? a.user?.id ?? a.userId}
                          </div>
                          <div className="text-ink-500 text-xs font-mono mt-0.5">
                            {a.provider} — {a.destination}
                          </div>
                          {a.isFrozen && (
                            <span className="text-red-300 text-xs font-semibold">· frozen</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-300 text-xs font-mono">
                          {a.initiationPayoutId ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-ink-300 text-xs">{a.currency}</td>
                        <td className="px-4 py-3 text-white text-sm font-mono">
                          {a.ledgerAllocations
                            ? formatCurrency(a.ledgerAllocations.totalMinor, a.currency)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {a.activeFraudFlags > 0 ? (
                            <span className="text-amber-400 font-semibold">
                              {a.activeFraudFlags}
                            </span>
                          ) : (
                            <span className="text-ink-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-300 text-xs">
                          {a.ledgerAllocations ? (
                            <>
                              <div>{a.ledgerAllocations.count} allocations</div>
                              <div className="text-ink-500 font-mono">
                                {formatCurrency(
                                  a.ledgerAllocations.totalMinor,
                                  a.ledgerAllocations.currency,
                                )}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-300 text-xs">
                          {a.reconciliationAttempts}
                        </td>
                        <td className="px-4 py-3 text-ink-400 text-xs">
                          {a.lastReconciliationAt
                            ? formatRelativeTime(a.lastReconciliationAt)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-ink-400 text-xs">
                          {a.escalatedAt ? formatRelativeTime(a.escalatedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openRelease(a)}
                            disabled={processing === a.id}
                            className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                          >
                            {processing === a.id ? 'Working...' : 'Release fence'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-ink-400 text-xs">
                <span>{total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-ink-700 border border-ink-600/50 rounded-lg px-2 py-1 text-ink-200 focus:outline-none focus:border-brand-500"
                >
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt} / page
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Previous
                </button>
                <span className="text-ink-400 text-xs">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )
      )}

      {/* Release fence modal */}
      {releaseFor && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-fence-title"
            className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full"
          >
            <h3 id="release-fence-title" className="text-white font-semibold mb-2">
              Release payout-account fence
            </h3>
            <p className="text-ink-400 text-sm mb-1">
              {releaseFor.provider} — {releaseFor.destination}
            </p>
            <p className="text-ink-500 text-xs font-mono mb-4">
              {releaseFor.id}
              {releaseFor.initiationPayoutId && <> · payout {releaseFor.initiationPayoutId}</>}
            </p>

            <label htmlFor="release-reason" className="text-ink-300 text-xs block mb-1">
              Release reason (required, ≥ {MIN_REASON_LENGTH} chars)
            </label>
            <textarea
              id="release-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this fence being released?"
              rows={3}
              maxLength={500}
              required
              autoFocus
              className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 mb-4"
            />

            <div className="space-y-3 mb-4">
              <div>
                <label htmlFor="release-provider-tx" className="text-ink-300 text-xs block mb-1">
                  Provider transaction id (optional)
                </label>
                <input
                  id="release-provider-tx"
                  value={providerTxId}
                  onChange={(e) => setProviderTxId(e.target.value)}
                  maxLength={255}
                  placeholder="txn_..."
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label htmlFor="release-resolution" className="text-ink-300 text-xs block mb-1">
                  Resolution summary (optional)
                </label>
                <textarea
                  id="release-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="e.g. paid, failed, cancelled"
                  rows={2}
                  maxLength={500}
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label
                  htmlFor="release-second-approver"
                  className="text-ink-300 text-xs block mb-1"
                >
                  Second approver id (required for high-value releases)
                </label>
                <input
                  id="release-second-approver"
                  value={secondApproverId}
                  onChange={(e) => setSecondApproverId(e.target.value)}
                  maxLength={255}
                  placeholder="operator id"
                  className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                />
                <p className="text-ink-500 text-xs mt-1">
                  High-value releases (exposure ≥ per-currency threshold) require a distinct second
                  approver or the request is rejected by the API.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={closeRelease}
                disabled={processing === releaseFor.id}
                className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={reason.trim().length < MIN_REASON_LENGTH || processing === releaseFor.id}
                className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
              >
                {processing === releaseFor.id ? 'Working...' : 'Confirm release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
