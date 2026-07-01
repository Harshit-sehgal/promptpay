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
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Payouts</h1>
          <p className="text-ink-300 text-sm">
            Available earnings, payout methods, and history
          </p>
        </div>

        {loading && <LoadingSpinner />}
        {error && !info && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {info && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <StatCard
                label="Available balance"
                value={formatCurrency(info.availableBalanceMinor, info.currency)}
                valueColor="text-brand-500"
                subtitle={`Minimum payout: $${info.minimumThresholdMinor / 100}`}
              />
              <StatCard
                label="Active payout methods"
                value={info.payoutAccounts.length.toString()}
              />
              <StatCard
                label="Total payout requests"
                value={requests.length.toString()}
              />
            </div>

            {/* Request payout */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <h2 className="text-white font-semibold mb-4">Request payout</h2>

              {info.availableBalanceMinor < info.minimumThresholdMinor ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <p className="text-amber-400 text-sm">
                    You need at least ${info.minimumThresholdMinor / 100} in confirmed earnings
                    before you can request a payout.
                  </p>
                </div>
              ) : info.payoutAccounts.length === 0 ? (
                <p className="text-ink-400 text-sm">
                  Add a payout method below first.
                </p>
              ) : (
                <form onSubmit={handleRequestPayout} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                        Payout method
                      </label>
                      <select
                        value={selectedAccountId}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        required
                        className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand-500"
                      >
                        <option value="">Select method...</option>
                        {info.payoutAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.provider} — {acc.destination}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-ink-200 text-sm font-medium mb-1.5 block">
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
                        className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>
                  {requestError && (
                    <p className="text-red-400 text-sm">{requestError}</p>
                  )}
                  <button
                    type="submit"
                    className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-6 py-2 rounded-lg"
                  >
                    Request payout
                  </button>
                </form>
              )}
            </div>

            {/* Payout methods */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">Payout methods</h2>
                <button
                  onClick={() => setShowMethodForm(!showMethodForm)}
                  className="text-brand-500 hover:text-brand-400 text-sm font-medium"
                >
                  {showMethodForm ? 'Cancel' : '+ Add method'}
                </button>
              </div>

              {showMethodForm && (
                <form onSubmit={handleAddMethod} className="space-y-4 mb-6 p-4 bg-ink-700/30 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-ink-200 text-sm font-medium mb-1.5 block">
                        Provider
                      </label>
                      <select
                        value={provider}
                        onChange={(e) => setProvider(e.target.value)}
                        className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white"
                      >
                        <option value="paypal_email">PayPal (email)</option>
                        <option value="manual">Manual</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-ink-200 text-sm font-medium mb-1.5 block">
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
                        className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
                  >
                    {submitting ? 'Adding...' : 'Add method'}
                  </button>
                </form>
              )}

              {info.payoutAccounts.length === 0 ? (
                <div className="text-ink-400 text-sm py-8 text-center border border-dashed border-ink-600/30 rounded-lg">
                  No payout methods yet. Add a PayPal email or manual method to start receiving
                  payouts.
                </div>
              ) : (
                <div className="space-y-2">
                  {info.payoutAccounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                      <div>
                        <p className="text-white font-medium capitalize">{acc.provider.replace('_', ' ')}</p>
                        <p className="text-ink-400 text-xs">{acc.destination}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {acc.isVerified ? (
                          <span className="text-emerald-400 text-xs">Verified</span>
                        ) : (
                          <span className="text-amber-400 text-xs">Unverified</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payout history */}
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
              <h2 className="text-white font-semibold mb-4">Recent payout requests</h2>
              {requests.length === 0 ? (
                <div className="text-ink-400 text-sm py-8 text-center border border-dashed border-ink-600/30 rounded-lg">
                  No payout requests yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {requests.map((req) => (
                    <div key={req.id} className="flex items-center justify-between bg-ink-700/50 rounded-lg p-4">
                      <div>
                        <p className="text-white font-mono">{formatCurrency(req.requestedAmountMinor, req.currency)}</p>
                        <p className="text-ink-400 text-xs">Requested {formatRelativeTime(req.createdAt)}</p>
                      </div>
                      <StatusBadge status={req.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      
</>
);
}
