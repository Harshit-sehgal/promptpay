'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

interface PendingPayout {
  id: string;
  userId: string;
  userEmail?: string;
  status: 'requested' | 'under_review' | 'approved' | 'processing';
  requestedAmountMinor: number;
  approvedAmountMinor?: number | null;
  currency: string;
  payoutAccount: { provider: string; destination: string };
  transactions?: Array<{ providerTxId?: string | null; status: string }>;
  createdAt: string;
}

type PendingPayoutsResponse = PendingPayout[] | { payouts?: PendingPayout[] };

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

  const fetchPayouts = useCallback(() => {
    setLoading(true);
    adminApi.getPendingPayouts()
      .then((res: { data: PendingPayoutsResponse }) => setPayouts(normalizePayouts(res.data)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load payouts')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await adminApi.approvePayout(id);
      fetchPayouts();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Approve failed'));
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
      setError('Missing provider transaction id. Process this payout first or reconcile it manually.');
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

  const totalsByCurrency = payouts.reduce<Record<string, number>>((totals, payout) => {
    const currency = payout.currency || 'USD';
    totals[currency] = (totals[currency] ?? 0) + payout.requestedAmountMinor;
    return totals;
  }, {});
  const totalSummary = formatCurrencyBreakdown(totalsByCurrency);

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Payout requests</h1>
          <p className="text-ink-300 text-sm">
            Approve or reject pending developer payouts
          </p>
        </div>

        {/* Summary */}
        <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-ink-400 text-xs uppercase tracking-wider">Pending payouts</p>
              <p className="text-3xl font-bold text-white">{payouts.length}</p>
            </div>
            <div>
              <p className="text-ink-400 text-xs uppercase tracking-wider">Total amount</p>
              <p className="text-2xl sm:text-3xl font-bold text-brand-500 font-mono break-words">
                {totalSummary}
              </p>
            </div>
          </div>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {payouts.length === 0 && !loading ? (
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
            <p className="text-ink-400 text-sm">No pending payouts. Queue clear.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {payouts.map((p) => (
              <div
                key={p.id}
                className="bg-ink-800 border border-ink-600/30 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-3xl font-bold text-white font-mono">
                      {formatCurrency(p.requestedAmountMinor, p.currency)}
                    </p>
                    <p className="text-ink-400 text-xs mt-1">
                      via {p.payoutAccount.provider} — {p.payoutAccount.destination}
                    </p>
                    <p className="text-ink-500 text-xs mt-1 uppercase tracking-wider">
                      {p.status.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.status !== 'processing' && (
                      <button
                        onClick={() => setRejectModalFor(p)}
                        disabled={processing === p.id}
                        className="bg-ink-700 hover:bg-ink-600 text-red-400 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                    )}
                    {(p.status === 'requested' || p.status === 'under_review') && (
                      <button
                        onClick={() => handleApprove(p.id)}
                        disabled={processing === p.id}
                        className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {processing === p.id ? 'Working...' : 'Approve'}
                      </button>
                    )}
                    {p.status === 'approved' && (
                      <button
                        onClick={() => handleProcess(p.id)}
                        disabled={processing === p.id}
                        className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {processing === p.id ? 'Working...' : 'Process'}
                      </button>
                    )}
                    {p.status === 'processing' && (
                      <button
                        onClick={() => handleMarkPaid(p)}
                        disabled={processing === p.id}
                        className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                      >
                        {processing === p.id ? 'Working...' : 'Mark paid'}
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-ink-500 text-xs">
                  User: <a href={`/admin/users?search=${encodeURIComponent(p.userId)}`} className="text-brand-400 hover:text-brand-300 underline">{p.userEmail || p.userId}</a>
                  <span className="mx-2">·</span>
                  Requested {formatRelativeTime(p.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Reject modal */}
        {rejectModalFor && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
            <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-white font-semibold mb-2">Reject payout</h3>
              <p className="text-ink-400 text-sm mb-4">
                Reject <span className="text-white">
                  {formatCurrency(rejectModalFor.requestedAmountMinor, rejectModalFor.currency)}
                </span>?
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason — visible to developer"
                rows={3}
                required
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 mb-4"
              />
              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={() => {
                    setRejectModalFor(null);
                    setRejectReason('');
                  }}
                  className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || processing === rejectModalFor.id}
                  className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      
</>
);

}
