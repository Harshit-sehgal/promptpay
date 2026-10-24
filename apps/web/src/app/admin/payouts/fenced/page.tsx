'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, Pill } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
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
      <PageHeader
        title="Fenced payout accounts"
        lede="Payout accounts locked by an in-flight provider-initiation fence. Release only after the referenced payout reaches a terminal state (paid / failed / rejected / cancelled)."
      />

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {loading && <LoadingSpinner />}

      {!loading && accounts.length === 0 ? (
        <Panel label="No fenced accounts">
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            No fenced payout accounts. All clear.
          </p>
        </Panel>
      ) : (
        !loading && (
          <>
            <Panel label="Fenced payout accounts" flush>
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Fenced payout accounts table, scrolls horizontally"
              >
                <table className="w-full min-w-[960px]">
                  <thead>
                    <tr>
                      <th className="text-left">Owner</th>
                      <th className="text-left">Payout</th>
                      <th className="text-left">Currency</th>
                      <th className="text-left">Exposure</th>
                      <th className="text-left">Fraud flags</th>
                      <th className="text-left">Ledger allocations</th>
                      <th className="text-left">Recon. attempts</th>
                      <th className="text-left">Last recon.</th>
                      <th className="text-left">Escalated</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="text-sm text-[var(--ink)]">
                            {a.user?.email ?? a.user?.id ?? a.userId}
                          </div>
                          <div className="dash-mono mt-0.5 text-xs text-[var(--muted)]">
                            {a.provider} — {a.destination}
                          </div>
                          {a.isFrozen && <Pill tone="bad">frozen</Pill>}
                        </td>
                        <td className="dash-mono text-xs">{a.initiationPayoutId ?? '—'}</td>
                        <td className="text-xs">{a.currency}</td>
                        <td className="dash-mono text-sm text-[var(--ink)]">
                          {a.ledgerAllocations
                            ? formatCurrency(a.ledgerAllocations.totalMinor, a.currency)
                            : '—'}
                        </td>
                        <td className="text-sm">
                          {a.activeFraudFlags > 0 ? (
                            <Pill tone="warn">{a.activeFraudFlags}</Pill>
                          ) : (
                            <span className="text-[var(--muted)]">0</span>
                          )}
                        </td>
                        <td className="text-xs">
                          {a.ledgerAllocations ? (
                            <>
                              <div>{a.ledgerAllocations.count} allocations</div>
                              <div className="dash-mono text-[var(--muted)]">
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
                        <td className="text-xs">{a.reconciliationAttempts}</td>
                        <td className="text-xs text-[var(--muted)]">
                          {a.lastReconciliationAt
                            ? formatRelativeTime(a.lastReconciliationAt)
                            : '—'}
                        </td>
                        <td className="text-xs text-[var(--muted)]">
                          {a.escalatedAt ? formatRelativeTime(a.escalatedAt) : '—'}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => openRelease(a)}
                            disabled={processing === a.id}
                            className="dash-btn dash-btn--primary dash-btn--sm"
                          >
                            {processing === a.id ? 'Working...' : 'Release fence'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>{total === 0 ? 'No results' : `Showing ${start}–${end} of ${total}`}</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 text-xs"
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
                  className="dash-btn dash-btn--secondary dash-btn--sm"
                >
                  Previous
                </button>
                <span className="text-xs text-[var(--muted)]">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="dash-btn dash-btn--secondary dash-btn--sm"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )
      )}

      {/* Release fence modal */}
      <ModalDialog open={!!releaseFor} onClose={closeRelease} labelledBy="release-fence-title">
        {releaseFor && (
          <>
            <h3 id="release-fence-title" className="mb-2 font-semibold text-[var(--ink)]">
              Release payout-account fence
            </h3>
            <p className="mb-1 text-sm text-[var(--copy)]">
              {releaseFor.provider} — {releaseFor.destination}
            </p>
            <p className="dash-mono mb-4 text-xs text-[var(--muted)]">
              {releaseFor.id}
              {releaseFor.initiationPayoutId && <> · payout {releaseFor.initiationPayoutId}</>}
            </p>

            <label htmlFor="release-reason" className="mb-1 block text-xs">
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
              className="mb-4 w-full px-4 py-3"
            />

            <div className="mb-4 space-y-3">
              <div>
                <label htmlFor="release-provider-tx" className="mb-1 block text-xs">
                  Provider transaction id (optional)
                </label>
                <input
                  id="release-provider-tx"
                  value={providerTxId}
                  onChange={(e) => setProviderTxId(e.target.value)}
                  maxLength={255}
                  placeholder="txn_..."
                  className="w-full px-4 py-3"
                />
              </div>
              <div>
                <label htmlFor="release-resolution" className="mb-1 block text-xs">
                  Resolution summary (optional)
                </label>
                <textarea
                  id="release-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="e.g. paid, failed, cancelled"
                  rows={2}
                  maxLength={500}
                  className="w-full px-4 py-3"
                />
              </div>
              <div>
                <label htmlFor="release-second-approver" className="mb-1 block text-xs">
                  Second approver id (required for high-value releases)
                </label>
                <input
                  id="release-second-approver"
                  value={secondApproverId}
                  onChange={(e) => setSecondApproverId(e.target.value)}
                  maxLength={255}
                  placeholder="operator id"
                  className="w-full px-4 py-3"
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  High-value releases (exposure ≥ per-currency threshold) require a distinct second
                  approver or the request is rejected by the API.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeRelease}
                disabled={processing === releaseFor.id}
                className="dash-btn dash-btn--secondary dash-btn--md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRelease}
                disabled={reason.trim().length < MIN_REASON_LENGTH || processing === releaseFor.id}
                className="dash-btn dash-btn--primary dash-btn--md"
              >
                {processing === releaseFor.id ? 'Working...' : 'Confirm release'}
              </button>
            </div>
          </>
        )}
      </ModalDialog>
    </>
  );
}
