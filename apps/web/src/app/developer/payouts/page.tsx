'use client';

import type { AxiosResponse } from 'axios';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { ActionLink, Notice, PageHeader, Panel, PanelHeader, Stat } from '@/components/dash';
import { earningsAreLive, useWaitLaunchMode } from '@/components/launch-mode-banner';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi, payoutApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';
import {
  type PayoutProviderReadiness,
  payoutProviderStatusLabel,
  selectablePayoutProviders,
} from '@/lib/payout-readiness';

import {
  CURRENCY_POLICY,
  majorToMinor,
  minorToMajorInputValue,
  PayoutProvider,
} from '@ateva/shared';

interface PayoutAccount {
  id: string;
  provider: string;
  destination: string;
  currency: string;
  isActive: boolean;
  isVerified: boolean;
  isFrozen?: boolean;
  initiationPayoutId?: string | null;
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
  const [providerReadiness, setProviderReadiness] = useState<PayoutProviderReadiness[] | undefined>(
    undefined,
  );
  const [providerReadinessError, setProviderReadinessError] = useState<string | null>(null);

  // Add payout method form
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [provider, setProvider] = useState('');
  const [destination, setDestination] = useState('');
  const [methodCurrency, setMethodCurrency] = useState('USD');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removingMethodId, setRemovingMethodId] = useState<string | null>(null);

  // Request payout form
  const [amount, setAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [requestError, setRequestError] = useState('');

  const availableBalanceByCurrency =
    info?.availableBalanceByCurrency ??
    (info ? { [info.currency]: info.availableBalanceMinor } : {});
  const selectedAccount = info?.payoutAccounts.find((account) => account.id === selectedAccountId);
  const selectedCurrency = selectedAccount?.currency || info?.currency || 'USD';
  const availableProviders = selectablePayoutProviders(providerReadiness);
  const unavailableProviders = providerReadiness?.filter(
    (entry) => !entry.available || entry.status !== 'available',
  );
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
  // A-089: the server already refuses payout requests while `payouts.requests`
  // is fail-closed. Showing a live request form anyway invites the user to fill
  // it in and be rejected, and implies earnings are payable when settlement has
  // never been enabled. Gate the form on the same published signal the banner
  // uses; this is disclosure, not enforcement — the API remains authoritative.
  const { mode: launchMode } = useWaitLaunchMode();
  const earningsLive = earningsAreLive(launchMode);

  // Readiness is runtime state: operator kill switches and provider credential
  // health can change without rebuilding the web app. Never retain a provider
  // selection that the latest API response does not mark available.
  useEffect(() => {
    const selectable = selectablePayoutProviders(providerReadiness);
    if (selectable.some((entry) => entry.provider === provider)) return;
    setProvider(selectable[0]?.provider ?? '');
  }, [providerReadiness, provider]);

  // Keep the chosen currency valid for the (possibly changed) provider.
  useEffect(() => {
    if (supportedMethodCurrencies.length === 0) return;
    if (!supportedMethodCurrencies.includes(methodCurrency)) {
      setMethodCurrency(supportedMethodCurrencies[0]);
    }
  }, [provider, supportedMethodCurrencies, methodCurrency]);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    setProviderReadiness(undefined);
    setProviderReadinessError(null);
    setShowMethodForm(false);
    const readinessRequest = payoutApi
      .getProviders()
      .then((res) => res.data.providers)
      .catch(() => {
        setProviderReadinessError(
          'Live payout provider readiness could not be confirmed. Registration is disabled.',
        );
        return undefined;
      });
    Promise.all([
      payoutApi.getInfo() as Promise<AxiosResponse<PayoutInfo>>,
      payoutApi.getHistory({ page: 1, limit: 20 }) as Promise<AxiosResponse<PayoutHistoryResponse>>,
      readinessRequest,
    ])
      .then(([infoRes, historyRes, readiness]) => {
        setInfo(infoRes.data);
        setRequests(historyRes.data.payouts || []);
        setProviderReadiness(readiness);
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

    if (!availableProviders.some((entry) => entry.provider === provider)) {
      setError(
        'This provider is not confirmed ready by the live API. Refresh readiness before registering a payout method.',
      );
      setSubmitting(false);
      return;
    }

    // Stripe Connect uses hosted onboarding instead of a raw destination input.
    if (provider === 'stripe_connect') {
      try {
        const baseUrl = window.location.origin + window.location.pathname;
        const res = await payoutApi.createStripeConnectOnboarding({
          refreshUrl: `${baseUrl}?stripe_status=refresh`,
          returnUrl: `${baseUrl}?stripe_status=success`,
          currency: methodCurrency.trim().toUpperCase() || 'USD',
        });
        window.location.assign(res.data.onboardingUrl);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to start Stripe onboarding'));
        setSubmitting(false);
      }
      return;
    }

    // Client-side validation for PayPal email format
    // Bounded before matching: `.` falls inside `[^\s@]`, so the tail of this
    // pattern backtracks quadratically on a long dotted string. 254 is the
    // RFC 5321 address limit, so nothing valid is turned away.
    if (
      provider === 'paypal_email' &&
      (destination.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination))
    ) {
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

  const handleRemoveMethod = async (payoutAccountId: string) => {
    if (removingMethodId) return;
    setRemovingMethodId(payoutAccountId);
    setError(null);
    setSuccessMsg(null);
    try {
      await payoutApi.removeMethod(payoutAccountId);
      if (selectedAccountId === payoutAccountId) setSelectedAccountId('');
      setRemoveConfirmId(null);
      setSuccessMsg('Payout method removed.');
      fetchData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to remove payout method'));
    } finally {
      setRemovingMethodId(null);
    }
  };

  const handleRequestPayout = async (e: FormEvent) => {
    e.preventDefault();
    setRequestError('');
    if (submitting) return;
    if (!selectedAccountId) {
      setRequestError('Please select a payout method');
      return;
    }
    if (requestBlockedByTwoFactor) {
      setRequestError('Enable two-factor authentication before requesting a payout.');
      return;
    }
    const amountMinor = (() => {
      try {
        return majorToMinor(amount, selectedCurrency);
      } catch {
        return null;
      }
    })();
    if (amountMinor === null || amountMinor <= 0n) {
      setRequestError('Enter a valid amount');
      return;
    }
    if (selectedAccount && !selectedAccount.isVerified) {
      setRequestError('This payout method is pending verification and cannot be used yet.');
      return;
    }
    if (selectedAccount?.isFrozen) {
      setRequestError(
        selectedAccount.initiationPayoutId
          ? 'This payout method is locked by an in-progress payout.'
          : 'This payout method is frozen by an operator and cannot be used.',
      );
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

    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Payouts" />

      {isAuthenticated && !user?.emailVerified && (
        <Notice
          tone="warn"
          title="Verify your email to request payouts"
          actions={
            <button
              type="button"
              onClick={handleRequestVerification}
              disabled={verifyBusy}
              className="dash-btn dash-btn--primary dash-btn--sm"
            >
              {verifyBusy ? 'Sending…' : 'Resend verification email'}
            </button>
          }
        >
          <p>Payouts are blocked until your email address is confirmed.</p>
          {verifyMsg && <p className="mt-2">{verifyMsg}</p>}
        </Notice>
      )}
      {info && requestBlockedByTwoFactor && (
        <Notice
          tone="warn"
          title="Enable 2FA to request payouts"
          actions={
            <ActionLink href="/developer/settings" variant="primary">
              Enable 2FA
            </ActionLink>
          }
        >
          Your operator requires two-factor authentication before money can leave your account.
        </Notice>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {successMsg && <Notice tone="ok">{successMsg}</Notice>}

      {info && (
        <>
          <div className="dash-grid dash-grid--3">
            <Panel label="Available balance">
              <Stat
                label="Available balance"
                value={formatCurrencyBreakdown(availableBalanceByCurrency)}
                detail={`Minimum payout: ${formatCurrency(info.minimumThresholdMinor, selectedCurrency)}`}
                chip
              />
            </Panel>
            <Panel label="Active payout methods">
              <Stat label="Active payout methods" value={info.payoutAccounts.length.toString()} />
            </Panel>
            <Panel label="Total payout requests">
              <Stat label="Total payout requests" value={requests.length.toString()} />
            </Panel>
          </div>

          {/* Request payout */}
          <Panel label="Request payout">
            <PanelHeader title="Request payout" />

            {!earningsLive ? (
              <Notice tone="neutral">
                Payout requests are unavailable while the platform is in{' '}
                <span className="font-semibold text-[var(--ink)]">
                  {launchMode === 'paused'
                    ? 'paused'
                    : launchMode === 'unknown'
                      ? 'an unconfirmed'
                      : 'wait-detection-only'}
                </span>{' '}
                mode. No earnings accrue and nothing is payable yet. You can still register and
                verify a payout account now so it is ready when settlement is enabled.
              </Notice>
            ) : requestBlockedByTwoFactor ? (
              <Notice tone="warn">
                Two-factor authentication is required before requesting a payout. Enable 2FA in
                settings, then return here.
              </Notice>
            ) : !hasPayoutableBalance ? (
              <Notice tone="warn">
                You need at least{' '}
                <span className="font-semibold text-[var(--ink)]">
                  {formatCurrency(info.minimumThresholdMinor, selectedCurrency)}
                </span>{' '}
                in confirmed earnings before you can request a payout.
              </Notice>
            ) : info.payoutAccounts.length === 0 ? (
              <p className="text-sm text-[var(--copy)]">Add a payout method below first.</p>
            ) : (
              <form onSubmit={handleRequestPayout} className="space-y-5">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Payout method</label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      required
                      className="w-full px-4 py-3.5 text-sm"
                    >
                      <option value="">Select method...</option>
                      {info.payoutAccounts.map((acc) => (
                        <option
                          key={acc.id}
                          value={acc.id}
                          disabled={
                            !acc.isVerified || acc.isFrozen || Boolean(acc.initiationPayoutId)
                          }
                        >
                          {acc.provider === 'paypal_email' ? 'PayPal' : acc.provider} —{' '}
                          {acc.destination} ({acc.currency})
                          {!acc.isVerified
                            ? ' (pending verification)'
                            : acc.initiationPayoutId
                              ? ' (payout in progress)'
                              : acc.isFrozen
                                ? ' (operator frozen)'
                                : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
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
                      className="w-full px-4 py-3.5 text-sm"
                    />
                  </div>
                  {/*
                    State both bounds before submission. The amount is validated
                    against the payout threshold and the available balance on
                    submit, but neither number appeared on screen until now — a
                    request over the balance was refused citing a figure the
                    developer had never been shown.
                  */}
                  {info && (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      Minimum {formatCurrency(info.minimumThresholdMinor, selectedCurrency)} ·
                      Available {formatCurrency(selectedAvailableMinor, selectedCurrency)}
                    </p>
                  )}
                </div>
                {requestError && <Notice tone="bad">{requestError}</Notice>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="dash-btn dash-btn--primary dash-btn--md"
                >
                  {submitting ? 'Requesting…' : 'Request payout'}
                </button>
              </form>
            )}
          </Panel>

          {/* Payout methods */}
          <Panel label="Payout methods" flush>
            <PanelHeader
              title="Payout methods"
              action={
                <button
                  type="button"
                  onClick={() => {
                    setShowMethodForm(!showMethodForm);
                    setSuccessMsg(null);
                  }}
                  disabled={!providerReadiness || availableProviders.length === 0}
                  title={
                    !providerReadiness
                      ? 'Live provider readiness is unavailable'
                      : availableProviders.length === 0
                        ? 'No payout provider is currently ready'
                        : undefined
                  }
                  className="dash-btn dash-btn--secondary dash-btn--sm"
                >
                  {showMethodForm ? 'Cancel' : '+ Add method'}
                </button>
              }
            />

            {(providerReadinessError ||
              (providerReadiness && availableProviders.length === 0) ||
              (showMethodForm && providerReadiness && availableProviders.length > 0)) && (
              <div className="grid gap-4 border-b border-[var(--hair)] px-[22px] py-5">
                {providerReadinessError && (
                  <Notice
                    tone="warn"
                    role="alert"
                    title="Payout method registration is temporarily disabled."
                    actions={
                      <button
                        type="button"
                        onClick={fetchData}
                        disabled={loading}
                        className="dash-btn dash-btn--secondary dash-btn--sm"
                      >
                        Retry readiness check
                      </button>
                    }
                  >
                    {providerReadinessError}
                  </Notice>
                )}

                {providerReadiness && availableProviders.length === 0 && (
                  <Notice tone="warn" title="No payout provider is currently ready.">
                    Existing methods remain visible, but registration stays disabled until the API
                    confirms a provider is configured, enabled, and healthy.
                  </Notice>
                )}

                {showMethodForm && providerReadiness && availableProviders.length > 0 && (
                  <form
                    onSubmit={handleAddMethod}
                    className="space-y-4 rounded-xl border border-[var(--hair)] p-5"
                  >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <div className={provider === 'stripe_connect' ? 'md:col-span-2' : ''}>
                        <label className="mb-1.5 block text-sm font-medium">Provider</label>
                        <select
                          value={provider}
                          onChange={(e) => {
                            setProvider(e.target.value);
                            setSuccessMsg(null);
                          }}
                          className="w-full px-4 py-3 text-sm"
                        >
                          <option value="">Select provider...</option>
                          {availableProviders.map((p) => (
                            <option key={p.provider} value={p.provider}>
                              {p.label}
                            </option>
                          ))}
                          {unavailableProviders && unavailableProviders.length > 0 && (
                            <>
                              <option disabled>──────────</option>
                              <option disabled value="">
                                Unavailable now:
                              </option>
                              {unavailableProviders.map((p) => (
                                <option key={p.provider} value={p.provider} disabled>
                                  {p.label} — {payoutProviderStatusLabel(p.status, p.available)}
                                </option>
                              ))}
                            </>
                          )}
                        </select>
                        <p className="mt-1.5 text-xs text-[var(--muted)]">
                          {unavailableProviders && unavailableProviders.length > 0
                            ? `Unavailable now: ${unavailableProviders
                                .map((entry) => entry.label)
                                .join(', ')}.`
                            : 'Every listed provider is confirmed ready by the live API.'}
                        </p>
                      </div>
                      {provider !== 'stripe_connect' && (
                        <div className="md:col-span-2">
                          <label className="mb-1.5 block text-sm font-medium">
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
                            autoComplete={provider === 'paypal_email' ? 'email' : 'off'}
                            inputMode={provider === 'paypal_email' ? 'email' : 'text'}
                            className="w-full px-4 py-3 text-sm"
                          />
                        </div>
                      )}
                      <div className={provider === 'stripe_connect' ? 'md:col-span-2' : ''}>
                        <label className="mb-1.5 block text-sm font-medium">Currency</label>
                        <select
                          value={methodCurrency}
                          onChange={(e) => setMethodCurrency(e.target.value)}
                          className="w-full px-4 py-3 text-sm"
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
                      disabled={submitting || !provider}
                      className="dash-btn dash-btn--primary dash-btn--md"
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
              </div>
            )}

            {info.payoutAccounts.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--muted)]">
                No payout methods yet. Add a currently available method to prepare for payouts.
              </div>
            ) : (
              <div className="dash-rows">
                {info.payoutAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)] capitalize">
                        {acc.provider === 'paypal_email'
                          ? 'PayPal'
                          : acc.provider.replace('_', ' ')}
                      </p>
                      <p className="dash-mono mt-0.5 text-xs text-[var(--copy)]">
                        {acc.destination}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{acc.currency}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={acc.isVerified ? 'approved' : 'pending'} />
                      {acc.initiationPayoutId ? (
                        <span className="text-[11px] font-medium text-[var(--copy)]">
                          Locked by payout in progress
                        </span>
                      ) : acc.isFrozen ? (
                        <span className="text-[11px] font-medium text-[var(--copy)]">
                          Frozen by operator
                        </span>
                      ) : removeConfirmId === acc.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-[11px] text-[var(--copy)]">
                            Remove this method?
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleRemoveMethod(acc.id)}
                            disabled={removingMethodId !== null}
                            className="dash-btn dash-btn--danger dash-btn--sm"
                          >
                            {removingMethodId === acc.id ? 'Removing…' : 'Confirm removal'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveConfirmId(null)}
                            disabled={removingMethodId !== null}
                            className="dash-btn dash-btn--ghost dash-btn--sm"
                          >
                            Keep method
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRemoveConfirmId(acc.id)}
                          disabled={removingMethodId !== null || !acc.isActive}
                          className="dash-btn dash-btn--ghost dash-btn--sm"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Payout history */}
          <Panel label="Recent payout requests" flush>
            <PanelHeader title="Recent payout requests" />
            {requests.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--muted)]">
                No payout requests yet.
              </div>
            ) : (
              <div className="dash-rows">
                {requests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="dash-mono text-sm text-[var(--ink)]">
                        {formatCurrency(req.requestedAmountMinor, req.currency)}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Requested {formatRelativeTime(req.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
