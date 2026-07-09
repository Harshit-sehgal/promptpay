'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface LedgerEntry {
  id: string;
  amountMinor: number;
  currency: string;
  entryType: string;
  description?: string;
  createdAt: string;
}

interface BillingBalance {
  currency: string;
  balanceMinor: number;
  totalDepositsMinor: number;
  totalChargesMinor: number;
  totalRefundsMinor: number;
}

interface BillingData {
  balanceMinor: number;
  currency: string;
  totalDepositsMinor: number;
  totalChargesMinor: number;
  totalRefundsMinor: number;
  balances?: BillingBalance[];
  entries: LedgerEntry[];
}

const DEPOSIT_CURRENCIES = [
  { code: 'usd', label: 'USD' },
  { code: 'eur', label: 'EUR' },
  { code: 'gbp', label: 'GBP' },
  { code: 'cad', label: 'CAD' },
  { code: 'aud', label: 'AUD' },
  { code: 'inr', label: 'INR' },
  { code: 'brl', label: 'BRL' },
  { code: 'mxn', label: 'MXN' },
  { code: 'sgd', label: 'SGD' },
] as const;

const FIXED_AMOUNTS = [{ minor: 5000 }, { minor: 10000 }, { minor: 25000 }, { minor: 50000 }];

const MIN_DEPOSIT_MINOR = 100; // $1.00

export default function AdvertiserBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deposit flow state
  const [selectedMinor, setSelectedMinor] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [depositCurrency, setDepositCurrency] =
    useState<(typeof DEPOSIT_CURRENCIES)[number]['code']>('usd');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    advertiserApi
      .getBilling()
      .then((res) => {
        setData(res.data as BillingData);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load billing')))
      .finally(() => setLoading(false));
  }, []);

  const getDepositAmount = (): number | null => {
    if (showCustom) {
      const parsed = parseInt(customAmount, 10);
      if (isNaN(parsed) || parsed < 1) return null;
      return parsed * 100; // Convert dollars to minor units
    }
    return selectedMinor;
  };

  const handleDeposit = async () => {
    const amountMinor = getDepositAmount();
    if (!amountMinor || amountMinor < MIN_DEPOSIT_MINOR) return;

    setDepositing(true);
    setDepositError(null);

    try {
      const res = await advertiserApi.createDepositSession(amountMinor, depositCurrency);
      const { url } = res.data as { sessionId: string; url: string };
      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err: unknown) {
      setDepositError(getErrorMessage(err, 'Failed to create deposit session'));
      setDepositing(false);
    }
  };

  const validAmount = getDepositAmount();
  const canDeposit = validAmount !== null && validAmount >= MIN_DEPOSIT_MINOR && !depositing;
  const displayDepositCurrency = depositCurrency.toUpperCase();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Billing</h1>
        <p className="text-ink-300 text-sm">Deposit history, charges, and account balance</p>
      </div>

      {loading && !data && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatCard
              label="Account balance"
              value={formatCurrency(data.balanceMinor, data.currency)}
              valueColor="text-brand-500"
            />
            <StatCard
              label="Total deposits"
              value={formatCurrency(data.totalDepositsMinor, data.currency)}
            />
            <StatCard
              label="Total charges"
              value={formatCurrency(data.totalChargesMinor, data.currency)}
            />
            <StatCard
              label="Total refunds"
              value={formatCurrency(data.totalRefundsMinor ?? 0, data.currency)}
              valueColor={data.totalRefundsMinor ? 'text-amber-400' : 'text-ink-300'}
            />
          </div>
          {data.balances && data.balances.length > 1 && (
            <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-4 mb-8">
              <p className="text-ink-300 text-xs uppercase tracking-wide mb-3">
                Balances by currency
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.balances.map((balance) => (
                  <div
                    key={balance.currency}
                    className="flex items-center justify-between bg-ink-700/50 rounded-lg px-3 py-2"
                  >
                    <span className="text-ink-300 text-sm">{balance.currency}</span>
                    <span className="text-white font-mono text-sm">
                      {formatCurrency(balance.balanceMinor, balance.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deposit card */}
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
            <h2 className="text-white font-semibold mb-2">Deposit funds</h2>
            <p className="text-ink-300 text-sm mb-5">
              Add funds to your account via Stripe. Your balance is used to run ad campaigns.
            </p>

            <div className="mb-4">
              <label
                htmlFor="deposit-currency"
                className="block text-ink-400 text-xs uppercase tracking-wide mb-1.5"
              >
                Deposit currency
              </label>
              <select
                id="deposit-currency"
                value={depositCurrency}
                onChange={(event) => {
                  setDepositCurrency(
                    event.target.value as (typeof DEPOSIT_CURRENCIES)[number]['code'],
                  );
                  setDepositError(null);
                }}
                className="bg-ink-700 border border-ink-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
              >
                {DEPOSIT_CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount presets */}
            <div className="flex flex-wrap gap-2 mb-4">
              {FIXED_AMOUNTS.map((amt) => (
                <button
                  key={amt.minor}
                  onClick={() => {
                    setSelectedMinor(amt.minor);
                    setShowCustom(false);
                    setCustomAmount('');
                    setDepositError(null);
                  }}
                  className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                    !showCustom && selectedMinor === amt.minor
                      ? 'bg-brand-500 border-brand-400 text-white shadow-lg shadow-brand-500/20'
                      : 'bg-ink-700 border-ink-600 text-ink-200 hover:border-ink-500 hover:text-white'
                  }`}
                >
                  {formatCurrency(amt.minor, displayDepositCurrency)}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowCustom(true);
                  setSelectedMinor(null);
                  setDepositError(null);
                }}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                  showCustom
                    ? 'bg-brand-500 border-brand-400 text-white shadow-lg shadow-brand-500/20'
                    : 'bg-ink-700 border-ink-600 text-ink-200 hover:border-ink-500 hover:text-white'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom amount input */}
            {showCustom && (
              <div className="mb-4">
                <div className="relative max-w-[200px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300 text-sm font-medium">
                    {displayDepositCurrency}
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Amount"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setDepositError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canDeposit) handleDeposit();
                    }}
                    className="w-full bg-ink-700 border border-ink-600 rounded-lg pl-14 pr-3 py-2.5 text-white text-sm placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all"
                    aria-label={`Custom deposit amount in ${displayDepositCurrency}`}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <p className="text-ink-400 text-xs mt-1.5">
                  Minimum deposit: {formatCurrency(MIN_DEPOSIT_MINOR, displayDepositCurrency)}
                </p>
              </div>
            )}

            {/* Deposit button */}
            <button
              onClick={handleDeposit}
              disabled={!canDeposit}
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 font-medium px-6 py-3 rounded-lg text-sm transition-all ${
                canDeposit
                  ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/30'
                  : 'bg-ink-700 text-ink-400 cursor-not-allowed'
              }`}
            >
              {depositing ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Opening Stripe Checkout…
                </>
              ) : validAmount ? (
                <>Deposit {formatCurrency(validAmount, displayDepositCurrency)} via Stripe</>
              ) : (
                'Select an amount to deposit'
              )}
            </button>

            {depositError && (
              <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-red-400 text-xs">{depositError}</p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 text-ink-400 text-xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span>
                Securely processed by Stripe. Funds are available immediately after payment.
              </span>
            </div>
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
                        {entry.description || entry.entryType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            entry.entryType === 'credit'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : entry.entryType === 'debit'
                                ? 'bg-red-500/20 text-red-400'
                                : entry.entryType === 'refund'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-ink-600 text-ink-200'
                          }`}
                        >
                          {entry.entryType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          entry.entryType === 'credit'
                            ? 'text-emerald-400'
                            : entry.entryType === 'debit'
                              ? 'text-red-400'
                              : 'text-ink-300'
                        }`}
                      >
                        {entry.entryType === 'credit' ? '+' : '−'}
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
