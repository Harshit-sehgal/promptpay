'use client';

import type { AxiosResponse } from 'axios';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner, StatCard, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi, payoutApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';
import { AVAILABLE_PAYOUT_PROVIDERS, COMING_SOON_PAYOUT_PROVIDERS } from '@/lib/payout-providers';

import {
  CURRENCY_POLICY,
  majorToMinor,
  minorToMajorInputValue,
  PayoutProvider,
} from '@waitlayer/shared';

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
  availableBalanceMinor: bigint;
  availableBalanceByCurrency?: Record<string, bigint>;
  minimumThresholdMinor: bigint;
  currency: string;
  requiresTwoFactorForPayout?: boolean;
  twoFactorEnabled?: boolean;
}

interface PayoutRequest {
  id: string;
  status: string;
  requestedAmountMinor: bigint;
  currency: string;
  createdAt: string;
  paidAt?: string;
}
export interface PayoutProviderReadiness {
  provider: string;
  label: string;
  status: 'available' | 'coming_soon';
  note: string;
  reason: string | null;
}

/**
 * Effective, selectable payout providers: only those the API reports as
 * `available` (not `coming_soon` and not missing). Fails closed to an empty
 * list when readiness could not be fetched (A-030).
 */
export function selectablePayoutProviders(
  readiness: PayoutProviderReadiness[] | undefined,
): PayoutProviderReadiness[] {
  if (!readiness) return [];
  return readiness.filter((p) => p.status === 'available');
}

interface PayoutHistoryResponse {
  payouts: PayoutRequest[];
  total: number;
  page: number;
  limit: number;
}

export default function DevPayoutsPage() {
  const { user, isAuthenticated } = useAuth();
  const [info, setInfo] = useState<PayoutInfo | null>(null);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  // Add payout method form
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [provider, setProvider] = useState('paypal_email');
  const [destination, setDestination] = useState('');
  const [methodCurrency, setMethodCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Request payout form
  const [amount, setAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [requestError, setRequestError] = useState('');

  const availableBalanceByCurrency =
    info?.availableBalanceByCurrency ??
    (info ? { [info.currency]: info.availableBalanceMinor } : {});
  const selectedAccount = info?.payoutAccounts.find((account) => account.id === selectedAccountId);
  const selectedCurrency = selectedAccount?.currency || info?.currency || 'USD';
  // A-031: only offer currencies the selected provider can actually settle,
  // matching the server-side isProviderSupportedForCurrency check so the user
  // cannot submit an invalid provider/currency combination.
  const supportedMethodCurrencies = Object.values(CURRENCY_POLICY)
    .filter((policy) => policy.providers.some((p) => p === (provider as PayoutProvider)))
    .map((policy) => policy.code)
    .sort();
  const selectedAvailableMinor = availableBalanceByCurrency[selectedCurrency] ?? 0n;
  const hasPayoutableBalance = Object.values(availableBalanceByCurrency).some((balanceMinor) =>
    info ? balanceMinor >= info.minimumThresholdMinor : false,
  );
  const payoutTwoFactorEnabled = user?.twoFactorEnabled === true || info?.twoFactorEnabled === true;
  const requestBlockedByTwoFactor =
    info?.requiresTwoFactorForPayout === true && !payoutTwoFactorEnabled;

  // Keep the chosen currency valid for the (possibly changed) provider.
  useEffect(() => {
    if (supportedMethodCurrencies.length === 0) return;
    if (!supportedMethodCurrencies.includes(methodCurrency)) {
      setMethodCurrency(supportedMethodCurrencies[0]);
    }
  }, [provider, supportedMethodCurrencies, methodCurrency]);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      payoutApi.getInfo() as Promise<AxiosResponse<PayoutInfo>>,
      payoutApi.getHistory({ page: 1, limit: 20 }) as Promise<AxiosResponse<PayoutHistoryResponse>>,
    ])
      .then(([infoRes, historyRes]) => {
        setInfo(infoRes.data);
        setRequests(historyRes.data.payouts || []);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load payout info')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Detect return from Stripe Connect onboarding and surface feedback.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get('stripe_status');
    if (!stripeStatus) return;
    if (stripeStatus === 'success') {
      setSuccessMsg('Stripe account connected. Your payout method will be verified shortly.');
    } else if (stripeStatus === 'refresh') {
      setError('Stripe connection was interrupted. Please try again.');
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  // A-015: payouts are blocked until the email is verified. Surface the block
  // and a self-service resend action inline so developers are never stuck.
  const handleRequestVerification = async () => {
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      await authApi.requestEmailVerification();
      setVerifyMsg('Verification email sent. Check your inbox to confirm.');
    } catch (err: unknown) {
      setVerifyMsg(getErrorMessage(err, 'Could not send verification email.'));
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleAddMethod = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    // Stripe Connect uses hosted onboarding instead of a raw destination input.
    if (provider === 'stripe_connect') {
      try {
        const baseUrl = window.location.origin + window.location.pathname;
        const res = await payoutApi.createStripeConnectOnboarding({
          refreshUrl: `${baseUrl}?stripe_status=refresh`,
          returnUrl: `${baseUrl}?stripe_status=success`,
          currency: methodCurrency.trim().toUpperCase() || 'USD',
        });
        window.location.href = res.data.onboardingUrl;
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to start Stripe onboarding'));
        setSubmitting(false);
      }
      return;
    }

    // Client-side validation for PayPal email format
    if (provider === 'paypal_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      setError('Enter a valid email address for PayPal');
      setSubmitting(false);
      return;
    }

    try {
      await payoutApi.addMethod({
        provider,
        destination,
        currency: methodCurrency.trim().toUpperCase() || 'USD',
      });
      setDestination('');
      setShowMethodForm(false);
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add payout method'));
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
    if (requestBlockedByTwoFactor) {
      setRequestError('Enable two-factor authentication before requesting a payout.');
      return;
    }
    const amountMajor = parseFloat(amount);
    const amountMinor = majorToMinor(amountMajor, selectedCurrency);
    if (isNaN(amountMajor) || amountMinor <= 0n) {
      setRequestError('Enter a valid amount');
      return;
    }
    if (selectedAccount && !selectedAccount.isVerified) {
      setRequestError('This payout method is pending verification and cannot be used yet.');
      return;
    }
    if (info && amountMinor < info.minimumThresholdMinor) {
      setRequestError(
        `Minimum payout is ${formatCurrency(info.minimumThresholdMinor, selectedCurrency)}`,
      );
      return;
    }
    if (amountMinor > selectedAvailableMinor) {
      setRequestError(
        `Available ${selectedCurrency} balance is ${formatCurrency(selectedAvailableMinor, selectedCurrency)}`,
      );
      return;
    }

    try {
      await payoutApi.requestPayout({
        payoutAccountId: selectedAccountId,
        amountMinor,
        currency: selectedCurrency,
      });
      setAmount('');
      fetchData();
    } catch (err: unknown) {
      setRequestError(getErrorMessage(err, 'Payout request failed'));
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {isAuthenticated && !user?.emailVerified && (
        <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5 mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-amber-800 font-semibold text-[14px]">
              Verify your email to request payouts
            </p>
            <p className="text-amber-700 text-xs mt-0.5">
              Payouts are blocked until your email address is confirmed.
            </p>
            {verifyMsg && <p className="text-amber-700 text-xs mt-2">{verifyMsg}</p>}
          </div>
          <button
            type="button"
            onClick={handleRequestVerification}
            disabled={verifyBusy}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-[13px] transition-colors"
          >
            {verifyBusy ? 'Sending…' : 'Resend verification email'}
          </button>
        </div>
      )}
      {info && requestBlockedByTwoFactor && (
        <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5 mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-amber-800 font-semibold text-[14px]">
              Enable 2FA to request payouts
            </p>
            <p className="text-amber-700 text-xs mt-0.5">
              Your operator requires two-factor authentication before money can leave your account.
            </p>
          </div>
          <Link
            href="/developer/settings"
            className="bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-2 rounded-lg text-[13px] transition-colors"
          >
            Enable 2FA
          </Link>
        </div>
      )}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Payouts</h1>
        <p className="text-surface-500 text-[15px] font-normal">
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
          <p className="text-red-600 text-sm font-normal">{error}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4 mb-6">
          <p className="text-emerald-700 text-sm font-normal">{successMsg}</p>
        </div>
      )}

      {info && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <StatCard
              label="Available balance"
              value={formatCurrencyBreakdown(availableBalanceByCurrency)}
              valueColor="text-brand-600"
              subtitle={`Minimum payout: ${formatCurrency(info.minimumThresholdMinor, selectedCurrency)}`}
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

            {requestBlockedByTwoFactor ? (
              <div className="bg-amber-50/30 border border-amber-100/60 rounded-xl p-5 text-amber-800 leading-relaxed text-[14px] font-normal">
                Two-factor authentication is required before requesting a payout. Enable 2FA in
                settings, then return here.
              </div>
            ) : !hasPayoutableBalance ? (
              <div className="bg-amber-50/30 border border-amber-100/60 rounded-xl p-5 text-amber-800 leading-relaxed text-[14px] font-normal">
                You need at least{' '}
                <span className="font-semibold">
                  {formatCurrency(info.minimumThresholdMinor, selectedCurrency)}
                </span>{' '}
                in confirmed earnings before you can request a payout.
              </div>
            ) : info.payoutAccounts.length === 0 ? (
              <p className="text-surface-500 text-sm font-normal">
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
                      className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3.5 text-surface-900 text-[14px] focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all font-normal"
                    >
                      <option value="">Select method...</option>
                      {info.payoutAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id} disabled={!acc.isVerified}>
                          {acc.provider === 'paypal_email' ? 'PayPal' : acc.provider} —{' '}
                          {acc.destination} ({acc.currency})
                          {acc.isVerified ? '' : ' (pending verification)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Amount ({selectedCurrency})
                    </label>
                    <input
                      type="number"
                      step={minorToMajorInputValue(1n, selectedCurrency)}
                      min={minorToMajorInputValue(info.minimumThresholdMinor, selectedCurrency)}
                      max={minorToMajorInputValue(selectedAvailableMinor, selectedCurrency)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      placeholder={minorToMajorInputValue(
                        info.minimumThresholdMinor,
                        selectedCurrency,
                      )}
                      className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3.5 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/20 transition-all font-normal"
                    />
                  </div>
                </div>
                {requestError && <p className="text-red-600 text-sm font-normal">{requestError}</p>}
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
              <h2 className="text-surface-900 font-bold text-[16px]">Payout methods</h2>{' '}
              <button
                onClick={() => {
                  setShowMethodForm(!showMethodForm);
                  setSuccessMsg(null);
                }}
                className="text-brand-600 hover:text-brand-700 text-sm font-semibold transition-colors"
              >
                {showMethodForm ? 'Cancel' : '+ Add method'}
              </button>
            </div>

            {showMethodForm && (
              <form
                onSubmit={handleAddMethod}
                className="space-y-4 mb-6 p-5 bg-slate-50/50 border border-slate-100/85 rounded-xl"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className={provider === 'stripe_connect' ? 'md:col-span-2' : ''}>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Provider
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => {
                        setProvider(e.target.value);
                        setSuccessMsg(null);
                      }}
                      className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] font-normal"
                    >
                      <option value="">Select provider...</option>
                      {AVAILABLE_PAYOUT_PROVIDERS.map((p) => (
                        <option key={p.provider} value={p.provider}>
                          {p.label}
                        </option>
                      ))}
                      <option disabled>──────────</option>
                      <option disabled value="">
                        Coming soon:
                      </option>
                      {COMING_SOON_PAYOUT_PROVIDERS.map((p) => (
                        <option key={p.provider} value={p.provider} disabled>
                          {p.label} — {p.note}
                        </option>
                      ))}
                    </select>
                    {/* A-030: only available providers are selectable.
                        Coming-soon providers are shown as disabled options with
                        invite-only labels. Automated rails (PayPal Payouts,
                        Stripe Connect, Wise) are invite-only at launch. */}
                    <p className="text-surface-500 text-xs mt-1.5 font-normal">
                      {COMING_SOON_PAYOUT_PROVIDERS.length > 0
                        ? `Automated providers (${COMING_SOON_PAYOUT_PROVIDERS.map((p) => p.label).join(', ')}) are invite-only at launch.`
                        : 'Add a payout method to start receiving earnings.'}
                    </p>
                  </div>
                  {provider !== 'stripe_connect' && (
                    <div className="md:col-span-2">
                      <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                        {provider === 'paypal_email' ? 'PayPal email' : 'Account details'}
                      </label>
                      <input
                        type="text"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        required
                        placeholder={provider === 'paypal_email' ? 'you@example.com' : 'Account ID'}
                        autoComplete={provider === 'paypal_email' ? 'email' : 'off'}
                        inputMode={provider === 'paypal_email' ? 'email' : 'text'}
                        className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] placeholder:text-surface-400 focus:outline-none focus:border-brand-400 transition-all font-normal"
                      />
                    </div>
                  )}
                  <div className={provider === 'stripe_connect' ? 'md:col-span-2' : ''}>
                    <label className="text-surface-700 text-[14px] font-medium mb-1.5 block">
                      Currency
                    </label>
                    <select
                      value={methodCurrency}
                      onChange={(e) => setMethodCurrency(e.target.value)}
                      className="w-full bg-white border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-[14px] font-normal"
                    >
                      {supportedMethodCurrencies.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-xl text-[14px] shadow-sm shadow-brand-500/10 transition-all"
                >
                  {submitting
                    ? provider === 'stripe_connect'
                      ? 'Connecting...'
                      : 'Adding...'
                    : provider === 'stripe_connect'
                      ? 'Connect with Stripe'
                      : 'Add method'}
                </button>
              </form>
            )}

            {info.payoutAccounts.length === 0 ? (
              <div className="text-surface-400 text-sm py-12 text-center border border-dashed border-surface-200 rounded-2xl font-normal">
                No payout methods yet. Add a PayPal email or manual method to start receiving
                payouts.
              </div>
            ) : (
              <div className="space-y-3">
                {info.payoutAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between bg-slate-50/50 border border-slate-100/80 rounded-xl p-4.5"
                  >
                    <div>
                      <p className="text-surface-900 font-medium capitalize text-[14px]">
                        {acc.provider === 'paypal_email'
                          ? 'PayPal'
                          : acc.provider.replace('_', ' ')}
                      </p>
                      <p className="text-surface-500 text-xs font-mono mt-0.5 font-normal">
                        {acc.destination}
                      </p>
                      <p className="text-surface-400 text-xs mt-0.5 font-normal">{acc.currency}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={acc.isVerified ? 'approved' : 'pending'} />
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
              <div className="text-surface-400 text-sm py-12 text-center border border-dashed border-surface-200 rounded-2xl font-normal">
                No payout requests yet.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between bg-slate-50/50 border border-slate-100/80 rounded-xl p-4.5"
                  >
                    <div>
                      <p className="text-surface-900 font-mono font-semibold text-[15px]">
                        {formatCurrency(req.requestedAmountMinor, req.currency)}
                      </p>
                      <p className="text-surface-500 text-xs mt-0.5 font-normal">
                        Requested {formatRelativeTime(req.createdAt)}
                      </p>
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
