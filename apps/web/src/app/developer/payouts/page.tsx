'use client';

import { useEffect, useState, FormEvent } from 'react';
import { LoadingSpinner, StatusBadge, StatCard } from '@/components';
import { payoutApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface PayoutAccount {
  id: string;
  provider: string;
  destination: string;
  currency: string;
  isActive: boolean;
  isVerified: boolean;
}

interface PayoutInfo {
  payoutAccounts: PayoutAccount[];
  availableBalanceMinor: number;
  minimumThresholdMinor: number;
  currency: string;
}

interface PayoutRequest {
  id: string;
  status: string;
  requestedAmountMinor: number;
  currency: string;
  createdAt: string;
  paidAt?: string;
}

export default function DevPayoutsPage() {
  const [info, setInfo] = useState<PayoutInfo | null>(null);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add payout method form
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [provider, setProvider] = useState('paypal_email');
  const [destination, setDestination] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Request payout form
  const [amount, setAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [requestError, setRequestError] = useState('');

  const fetchData = () => {
    setLoading(true);
    Promise.all([payoutApi.getInfo(), payoutApi.getHistory({ page: 1, limit: 20 })])
      .then(([infoRes, historyRes]: any) => {
        setInfo(infoRes.data);
        setRequests(historyRes.data.payouts || []);
      })
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load payout info'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddMethod = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await payoutApi.addMethod({ provider, destination, currency: 'USD' });
      setDestination('');
      setShowMethodForm(false);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add payout method');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPayout = async (e: FormEvent) => {
    e.preventDefault();
    setRequestError('');
    if (!selectedAccountId) {
      setRequestError('Please select a payout method');
      return;
    }
    const amountMinor = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) {
      setRequestError('Enter a valid amount');
      return;
    }
    if (info && amountMinor < info.minimumThresholdMinor) {
      setRequestError(`Minimum payout is $${info.minimumThresholdMinor / 100}`);
      return;
    }

    try {
      await payoutApi.requestPayout({
        payoutAccountId: selectedAccountId,
        amountMinor,
        currency: 'USD',
      });
      setAmount('');
      fetchData();
    } catch (err: any) {
      setRequestError(err.response?.data?.message || 'Payout request failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Payouts</h1>
        <p className="text-surface-500 text-[15px]">
          Available earnings, payout methods, and history
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && !info && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {info && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <StatCard
              label="Available balance"
              value={formatCurrency(info.availableBalanceMinor, info.currency)}
              valueColor="text-brand-600"
              subtitle={`Minimum payout: $${info.minimumThresholdMinor / 100}`}
              variant="light"
            />
            <StatCard
              label="Active payout methods"
              value={info.payoutAccounts.length.toString()}
              variant="light"
            />
            <StatCard
              label="Total payout requests"
              value={requests.length.toString()}
              variant="light"
            />
          </div>

          {/* Request payout */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm mb-8">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Request payout</h2>

            {info.availableBalanceMinor < info.minimumThresholdMinor ? (
              <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-5 text-amber-700 leading-relaxed text-[14px]">
                You need at least <span className="font-semibold">${info.minimumThresholdMinor / 100}</span> in confirmed earnings
                before you can request a payout.
              </div>
            ) : info.payoutAccounts.length === 0 ? (
              <p className="text-surface-500 text-sm">
                Add a payout method below first.
              </p>
            ) : (
              <form onSubmit={handleRequestPayout} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Payout method
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      required
                      className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3.5 text-surface-900 text-[14px] focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
                    >
                      <option value="">Select method...</option>
                      {info.payoutAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.provider === 'paypal_email' ? 'PayPal' : acc.provider} — {acc.destination}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Amount (USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={(info.minimumThresholdMinor / 100).toString()}
                      max={(info.availableBalanceMinor / 100).toString()}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      placeholder={`${(info.minimumThresholdMinor / 100).toFixed(2)}`}
                      className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3.5 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all"
                    />
                  </div>
                </div>
                {requestError && (
                  <p className="text-red-600 text-sm">{requestError}</p>
                )}
                <button
                  type="submit"
                  className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-2.5 rounded-xl text-[14px] shadow-sm shadow-brand-500/10 transition-all"
                >
                  Request payout
                </button>
              </form>
            )}
          </div>

          {/* Payout methods */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm mb-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-surface-900 font-bold text-[16px]">Payout methods</h2>
              <button
                onClick={() => setShowMethodForm(!showMethodForm)}
                className="text-brand-600 hover:text-brand-700 text-sm font-semibold transition-colors"
              >
                {showMethodForm ? 'Cancel' : '+ Add method'}
              </button>
            </div>

            {showMethodForm && (
              <form onSubmit={handleAddMethod} className="space-y-4 mb-6 p-5 bg-surface-50 border border-surface-200/60 rounded-xl">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Provider
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px]"
                    >
                      <option value="paypal_email">PayPal (email)</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      {provider === 'paypal_email' ? 'PayPal email' : 'Account details'}
                    </label>
                    <input
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      required
                      placeholder={
                        provider === 'paypal_email' ? 'you@example.com' : 'Account ID'
                      }
                      className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 transition-all"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-xl text-[14px] shadow-sm shadow-brand-500/10 transition-all"
                >
                  {submitting ? 'Adding...' : 'Add method'}
                </button>
              </form>
            )}

            {info.payoutAccounts.length === 0 ? (
              <div className="text-surface-400 text-sm py-12 text-center border border-dashed border-surface-200 rounded-2xl">
                No payout methods yet. Add a PayPal email or manual method to start receiving
                payouts.
              </div>
            ) : (
              <div className="space-y-3">
                {info.payoutAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between bg-surface-50/50 border border-surface-200/60 rounded-xl p-4.5">
                    <div>
                      <p className="text-surface-900 font-semibold capitalize text-[14px]">
                        {acc.provider === 'paypal_email' ? 'PayPal' : acc.provider.replace('_', ' ')}
                      </p>
                      <p className="text-surface-500 text-xs font-mono mt-0.5">{acc.destination}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {acc.isVerified ? (
                        <span className="bg-emerald-50 border border-emerald-200/60 text-emerald-600 text-xs font-semibold px-2.5 py-1 rounded-full">Verified</span>
                      ) : (
                        <span className="bg-amber-50 border border-amber-200/60 text-amber-600 text-xs font-semibold px-2.5 py-1 rounded-full">Unverified</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payout history */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Recent payout requests</h2>
            {requests.length === 0 ? (
              <div className="text-surface-400 text-sm py-12 text-center border border-dashed border-surface-200 rounded-2xl">
                No payout requests yet.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between bg-surface-50/50 border border-surface-200/60 rounded-xl p-4.5">
                    <div>
                      <p className="text-surface-900 font-mono font-bold text-[15px]">
                        {formatCurrency(req.requestedAmountMinor, req.currency)}
                      </p>
                      <p className="text-surface-500 text-xs mt-0.5">Requested {formatRelativeTime(req.createdAt)}</p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
