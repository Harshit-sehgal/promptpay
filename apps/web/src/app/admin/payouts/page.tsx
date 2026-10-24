'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, Stat } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

import {
  authoritativePayoutAmountMinor,
  majorInputToMinor,
  minorToMajorInputValue,
} from './amounts';

interface PendingPayout {
  id: string;
  userId: string;
  user?: { email?: string | null; name?: string | null; trustLevel?: string | null };
  status: 'requested' | 'under_review' | 'approved' | 'processing';
  requestedAmountMinor: bigint;
  approvedAmountMinor?: bigint | null;
  currency: string;
  payoutAccount: {
    id: string;
    provider: string;
    destination: string;
    isVerified?: boolean;
    isFrozen?: boolean;
  };
  transactions?: Array<{ providerTxId?: string | null; status: string }>;
  createdAt: string;
}

type PendingPayoutsResponse = PendingPayout[] | { payouts?: PendingPayout[] };

type PayoutAccountAction = {
  payout: PendingPayout;
  mode: 'freeze' | 'unfreeze';
};

function normalizePayouts(data: PendingPayoutsResponse): PendingPayout[] {
  return Array.isArray(data) ? data : data.payouts || [];
}

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState<PendingPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectModalFor, setRejectModalFor] = useState<PendingPayout | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [approveModalFor, setApproveModalFor] = useState<PendingPayout | null>(null);
  const [approveAmount, setApproveAmount] = useState('');

  const [reconcileModalFor, setReconcileModalFor] = useState<PendingPayout | null>(null);
  const [reconcileProviderTxId, setReconcileProviderTxId] = useState('');
  const [reconcileAmount, setReconcileAmount] = useState('');
  const [reconcilePaidAt, setReconcilePaidAt] = useState('');

  const [accountAction, setAccountAction] = useState<PayoutAccountAction | null>(null);
  const [accountActionReason, setAccountActionReason] = useState('');

  const fetchPayouts = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getPendingPayouts()
      .then((res: { data: PendingPayoutsResponse }) => setPayouts(normalizePayouts(res.data)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load payouts')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const openApproveModal = (p: PendingPayout) => {
    setApproveModalFor(p);
    setApproveAmount(minorToMajorInputValue(authoritativePayoutAmountMinor(p), p.currency));
  };

  const handleApproveWithAmount = async () => {
    if (!approveModalFor) return;
    const trimmed = approveAmount.trim();
    let amountMinor: bigint | undefined;
    if (trimmed !== '') {
      const parsedAmountMinor = majorInputToMinor(trimmed, approveModalFor.currency);
      if (parsedAmountMinor === null || parsedAmountMinor <= 0n) {
        setError('Enter a valid approval amount');
        return;
      }
      amountMinor = parsedAmountMinor;
      if (amountMinor > approveModalFor.requestedAmountMinor) {
        setError('Approved amount cannot exceed the requested amount');
        return;
      }
    }
    setProcessing(approveModalFor.id);
    try {
      await adminApi.approvePayout(approveModalFor.id, undefined, amountMinor);
      setApproveModalFor(null);
      setApproveAmount('');
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Approve failed'));
    } finally {
      setProcessing(null);
    }
  };

  const openReconcileModal = (p: PendingPayout) => {
    setReconcileModalFor(p);
    setReconcileProviderTxId('');
    setReconcileAmount(minorToMajorInputValue(authoritativePayoutAmountMinor(p), p.currency));
    setReconcilePaidAt(new Date().toISOString().slice(0, 16));
  };

  const handleReconcile = async () => {
    if (!reconcileModalFor) return;
    if (!reconcileProviderTxId.trim()) {
      setError('Provider transaction id is required for manual reconciliation');
      return;
    }
    const amountMinor = majorInputToMinor(reconcileAmount, reconcileModalFor.currency);
    if (amountMinor === null || amountMinor <= 0n) {
      setError('Enter a valid paid amount');
      return;
    }
    setProcessing(reconcileModalFor.id);
    try {
      await adminApi.markPayoutPaid(reconcileModalFor.id, {
        providerTxId: reconcileProviderTxId.trim(),
        paidAt: new Date(reconcilePaidAt || Date.now()).toISOString(),
        amountMinor,
        currency: reconcileModalFor.currency,
      });
      setReconcileModalFor(null);
      setReconcileProviderTxId('');
      setReconcileAmount('');
      setReconcilePaidAt('');
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Reconcile failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleProcess = async (id: string) => {
    setProcessing(id);
    try {
      await adminApi.processPayout(id);
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Process failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleMarkPaid = async (payout: PendingPayout) => {
    const providerTxId = payout.transactions?.[0]?.providerTxId;
    if (!providerTxId) {
      setError(
        'Missing provider transaction id. Process this payout first or reconcile it manually.',
      );
      return;
    }
    setProcessing(payout.id);
    try {
      await adminApi.markPayoutPaid(payout.id, {
        providerTxId,
        paidAt: new Date().toISOString(),
        amountMinor: payout.approvedAmountMinor ?? payout.requestedAmountMinor,
        currency: payout.currency,
      });
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Mark-paid failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleVerifyAccount = async (payout: PendingPayout) => {
    setProcessing(payout.id);
    try {
      await adminApi.verifyPayoutAccount(payout.payoutAccount.id, true);
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Verification failed'));
    } finally {
      setProcessing(null);
    }
  };

  const openAccountAction = (payout: PendingPayout) => {
    setAccountAction({
      payout,
      mode: payout.payoutAccount.isFrozen ? 'unfreeze' : 'freeze',
    });
    setAccountActionReason('');
  };

  const closeAccountAction = () => {
    setAccountAction(null);
    setAccountActionReason('');
  };

  const handleAccountAction = async () => {
    if (!accountAction || !accountActionReason.trim()) return;

    const { payout, mode } = accountAction;
    setProcessing(payout.id);
    setError(null);
    try {
      const reason = accountActionReason.trim();
      if (mode === 'freeze') {
        await adminApi.freezePayoutAccount(payout.payoutAccount.id, reason);
      } else {
        await adminApi.unfreezePayoutAccount(payout.payoutAccount.id, reason);
      }
      closeAccountAction();
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, `Failed to ${mode} payout account`));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModalFor || !rejectReason.trim()) return;
    setProcessing(rejectModalFor.id);
    try {
      await adminApi.rejectPayout(rejectModalFor.id, rejectReason);
      setRejectModalFor(null);
      setRejectReason('');
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Reject failed'));
    } finally {
      setProcessing(null);
    }
  };

  const totalsByCurrency = payouts.reduce<Record<string, bigint>>((totals, payout) => {
    const currency = payout.currency || 'USD';
    totals[currency] = (totals[currency] ?? 0n) + payout.requestedAmountMinor;
    return totals;
  }, {});
  const totalSummary = formatCurrencyBreakdown(totalsByCurrency);

  return (
    <>
      <PageHeader title="Payout requests" lede="Approve or reject pending developer payouts" />

      {/* Summary */}
      <Panel label="Payout summary">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Pending payouts" value={payouts.length} />
          <Stat
            label="Total amount"
            value={<span className="break-words">{totalSummary}</span>}
            chip
          />
        </div>
      </Panel>

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {payouts.length === 0 && !loading ? (
        <Panel label="No pending payouts">
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            No pending payouts. Queue clear.
          </p>
        </Panel>
      ) : (
        <Panel label="Pending payouts" flush>
          <div className="dash-rows">
            {payouts.map((p) => (
              <div key={p.id}>
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="dash-mono text-3xl font-bold text-[var(--ink)]">
                      {formatCurrency(p.requestedAmountMinor, p.currency)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--copy)]">
                      <span>
                        via {p.payoutAccount.provider} — {p.payoutAccount.destination}
                      </span>
                      {p.payoutAccount.isVerified === false && (
                        <span className="font-semibold text-[var(--ink)]">· unverified</span>
                      )}
                      {p.payoutAccount.isFrozen && (
                        <span className="font-semibold text-[var(--ink)]">· frozen</span>
                      )}
                    </p>
                    <p className="dash-mono mt-1 text-xs text-[var(--muted)]">
                      Account {p.payoutAccount.id}
                    </p>
                    <p className="dash-eyebrow mt-1">{p.status.replace('_', ' ')}</p>
                    {p.payoutAccount.isFrozen && (
                      <p className="mt-2 text-xs text-[var(--ink)]">
                        Outbound processing is blocked until this payout account is unfrozen.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openAccountAction(p)}
                      disabled={processing === p.id}
                      className={`dash-btn dash-btn--sm ${
                        p.payoutAccount.isFrozen ? 'dash-btn--secondary' : 'dash-btn--danger'
                      }`}
                    >
                      {p.payoutAccount.isFrozen ? 'Unfreeze account' : 'Freeze account'}
                    </button>
                    {p.status !== 'processing' && (
                      <button
                        onClick={() => setRejectModalFor(p)}
                        disabled={processing === p.id}
                        className="dash-btn dash-btn--secondary dash-btn--sm"
                      >
                        Reject
                      </button>
                    )}
                    {p.payoutAccount.isVerified === false && (
                      <button
                        onClick={() => handleVerifyAccount(p)}
                        disabled={processing === p.id}
                        className="dash-btn dash-btn--primary dash-btn--sm"
                      >
                        {processing === p.id ? 'Working...' : 'Verify method'}
                      </button>
                    )}
                    {(p.status === 'requested' || p.status === 'under_review') && (
                      <button
                        onClick={() => openApproveModal(p)}
                        disabled={processing === p.id}
                        className="dash-btn dash-btn--primary dash-btn--sm"
                      >
                        {processing === p.id ? 'Working...' : 'Approve'}
                      </button>
                    )}
                    {p.status === 'approved' && (
                      <button
                        onClick={() => handleProcess(p.id)}
                        disabled={processing === p.id || p.payoutAccount.isFrozen}
                        title={
                          p.payoutAccount.isFrozen
                            ? 'Unfreeze this payout account before processing'
                            : undefined
                        }
                        className="dash-btn dash-btn--primary dash-btn--sm"
                      >
                        {processing === p.id ? 'Working...' : 'Process'}
                      </button>
                    )}
                    {p.status === 'processing' && (
                      <button
                        onClick={() => handleMarkPaid(p)}
                        disabled={processing === p.id}
                        className="dash-btn dash-btn--primary dash-btn--sm"
                      >
                        {processing === p.id ? 'Working...' : 'Mark paid'}
                      </button>
                    )}
                    {p.status === 'processing' && (
                      <button
                        onClick={() => openReconcileModal(p)}
                        disabled={processing === p.id}
                        className="dash-btn dash-btn--secondary dash-btn--sm"
                      >
                        Reconcile
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-[var(--muted)]">
                  User:{' '}
                  <a
                    href={`/admin/users?search=${encodeURIComponent(p.user?.email || p.userId)}`}
                    className="text-[var(--ink)] underline"
                  >
                    {p.user?.email || p.user?.name || p.userId}
                  </a>
                  {p.user?.trustLevel && (
                    <span className="ml-2">· trust {p.user.trustLevel.replace(/_/g, ' ')}</span>
                  )}
                  <span className="mx-2">·</span>
                  Requested {formatRelativeTime(p.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Payout-account emergency freeze / unfreeze modal */}
      <ModalDialog
        open={!!accountAction}
        onClose={() => {
          setAccountAction(null);
          setAccountActionReason('');
        }}
        labelledBy="payout-account-action-title"
      >
        {accountAction && (
          <>
            <h3 id="payout-account-action-title" className="mb-2 font-semibold text-[var(--ink)]">
              {accountAction.mode === 'freeze'
                ? 'Freeze payout account'
                : 'Unfreeze payout account'}
            </h3>
            <p className="mb-1 text-sm text-[var(--copy)]">
              {accountAction.payout.payoutAccount.provider} —{' '}
              {accountAction.payout.payoutAccount.destination}
            </p>
            <p className="dash-mono mb-4 text-xs text-[var(--muted)]">
              {accountAction.payout.payoutAccount.id}
            </p>
            <label htmlFor="payout-account-action-reason" className="mb-1 block text-xs">
              Operator reason
            </label>
            <textarea
              id="payout-account-action-reason"
              value={accountActionReason}
              onChange={(e) => setAccountActionReason(e.target.value)}
              placeholder="Reason for the audit trail"
              rows={3}
              maxLength={500}
              required
              autoFocus
              className="mb-4 w-full px-4 py-3"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeAccountAction}
                disabled={processing === accountAction.payout.id}
                className="dash-btn dash-btn--secondary dash-btn--md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAccountAction}
                disabled={!accountActionReason.trim() || processing === accountAction.payout.id}
                className={`dash-btn dash-btn--md ${
                  accountAction.mode === 'freeze' ? 'dash-btn--danger' : 'dash-btn--primary'
                }`}
              >
                {processing === accountAction.payout.id
                  ? 'Working...'
                  : accountAction.mode === 'freeze'
                    ? 'Confirm freeze'
                    : 'Confirm unfreeze'}
              </button>
            </div>
          </>
        )}
      </ModalDialog>

      {/* Reject modal */}
      <ModalDialog
        open={!!rejectModalFor}
        onClose={() => {
          setRejectModalFor(null);
          setRejectReason('');
        }}
      >
        {rejectModalFor && (
          <>
            <h3 className="mb-2 font-semibold text-[var(--ink)]">Reject payout</h3>
            <p className="mb-4 text-sm text-[var(--copy)]">
              Reject{' '}
              <span className="text-[var(--ink)]">
                {formatCurrency(rejectModalFor.requestedAmountMinor, rejectModalFor.currency)}
              </span>
              ?
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (shown to the developer)"
              rows={3}
              required
              className="mb-4 w-full px-4 py-3"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setRejectModalFor(null);
                  setRejectReason('');
                }}
                className="dash-btn dash-btn--secondary dash-btn--md"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || processing === rejectModalFor.id}
                className="dash-btn dash-btn--danger dash-btn--md"
              >
                Reject
              </button>
            </div>
          </>
        )}
      </ModalDialog>

      {/* Approve (partial) modal */}
      <ModalDialog
        open={!!approveModalFor}
        onClose={() => {
          setApproveModalFor(null);
          setApproveAmount('');
        }}
      >
        {approveModalFor && (
          <>
            <h3 className="mb-2 font-semibold text-[var(--ink)]">Approve payout</h3>
            <p className="mb-4 text-sm text-[var(--copy)]">
              Requested{' '}
              <span className="text-[var(--ink)]">
                {formatCurrency(approveModalFor.requestedAmountMinor, approveModalFor.currency)}
              </span>
              . Leave the amount blank to approve the full requested amount, or enter a lower amount
              for a partial approval.
            </p>
            <label className="mb-1 block text-xs">
              Approved amount ({approveModalFor.currency})
            </label>
            <input
              type="number"
              step={minorToMajorInputValue(1n, approveModalFor.currency)}
              min={minorToMajorInputValue(1n, approveModalFor.currency)}
              max={minorToMajorInputValue(
                approveModalFor.requestedAmountMinor,
                approveModalFor.currency,
              )}
              value={approveAmount}
              onChange={(e) => setApproveAmount(e.target.value)}
              className="mb-4 w-full px-4 py-3"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setApproveModalFor(null);
                  setApproveAmount('');
                }}
                className="dash-btn dash-btn--secondary dash-btn--md"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveWithAmount}
                disabled={processing === approveModalFor.id}
                className="dash-btn dash-btn--primary dash-btn--md"
              >
                {processing === approveModalFor.id ? 'Working...' : 'Approve'}
              </button>
            </div>
          </>
        )}
      </ModalDialog>

      {/* Manual reconciliation modal */}
      <ModalDialog
        open={!!reconcileModalFor}
        onClose={() => {
          setReconcileModalFor(null);
          setReconcileProviderTxId('');
          setReconcileAmount('');
          setReconcilePaidAt('');
        }}
      >
        {reconcileModalFor && (
          <>
            <h3 className="mb-2 font-semibold text-[var(--ink)]">Manual reconciliation</h3>
            <p className="mb-4 text-sm text-[var(--copy)]">
              Record an external provider payment for{' '}
              <span className="text-[var(--ink)]">
                {formatCurrency(reconcileModalFor.requestedAmountMinor, reconcileModalFor.currency)}
              </span>
              . No provider transaction id exists yet, so enter the details manually.
            </p>
            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs">Provider transaction id</label>
                <input
                  value={reconcileProviderTxId}
                  onChange={(e) => setReconcileProviderTxId(e.target.value)}
                  placeholder="txn_..."
                  className="w-full px-4 py-3"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">
                  Paid amount ({reconcileModalFor.currency})
                </label>
                <input
                  type="number"
                  step={minorToMajorInputValue(1n, reconcileModalFor.currency)}
                  min={minorToMajorInputValue(1n, reconcileModalFor.currency)}
                  max={minorToMajorInputValue(
                    authoritativePayoutAmountMinor(reconcileModalFor),
                    reconcileModalFor.currency,
                  )}
                  value={reconcileAmount}
                  onChange={(e) => setReconcileAmount(e.target.value)}
                  className="w-full px-4 py-3"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Paid at</label>
                <input
                  type="datetime-local"
                  value={reconcilePaidAt}
                  onChange={(e) => setReconcilePaidAt(e.target.value)}
                  className="w-full px-4 py-3"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setReconcileModalFor(null);
                  setReconcileProviderTxId('');
                  setReconcileAmount('');
                  setReconcilePaidAt('');
                }}
                className="dash-btn dash-btn--secondary dash-btn--md"
              >
                Cancel
              </button>
              <button
                onClick={handleReconcile}
                disabled={processing === reconcileModalFor.id}
                className="dash-btn dash-btn--primary dash-btn--md"
              >
                {processing === reconcileModalFor.id ? 'Working...' : 'Mark paid'}
              </button>
            </div>
          </>
        )}
      </ModalDialog>
    </>
  );
}
