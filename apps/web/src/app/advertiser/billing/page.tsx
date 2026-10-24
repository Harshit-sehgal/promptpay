'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, Stat, type Tone } from '@/components/dash';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

import {
  CURRENCY_POLICY,
  depositMinimumMinor,
  majorToMinor,
  minorToMajorInputValue,
} from '@ateva/shared';

interface LedgerEntry {
  id: string;
  amountMinor: bigint;
  currency: string;
  entryType: string;
  description?: string;
  createdAt: string;
}

interface BillingBalance {
  currency: string;
  balanceMinor: bigint;
  totalDepositsMinor: bigint;
  totalChargesMinor: bigint;
  totalRefundsMinor: bigint;
}

interface BillingData {
  balanceMinor: bigint;
  currency: string;
  totalDepositsMinor: bigint;
  totalChargesMinor: bigint;
  totalRefundsMinor: bigint;
  balances?: BillingBalance[];
  entries: LedgerEntry[];
}

// A-081: derive deposit currencies from the single source of truth
// (CURRENCY_POLICY) so every currency a user can deposit is also spendable by a
// self-service campaign in the same currency and has payout-provider support.
// Adding a depositable currency is now a one-line change in the shared policy
// instead of risking a hardcoded mismatch that strands deposited funds.
const DEPOSIT_CURRENCIES = Object.keys(CURRENCY_POLICY).map((code) => ({
  code: code.toLowerCase(),
  label: code,
}));

// Per-currency deposit presets (minor units). Keeps choices sensible and
// never below the per-currency floor (A-031). USD is the baseline; JPY offers
// small-yen presets; any other currency scales from its policy minimum.
const DEPOSIT_PRESETS_MINOR: Record<string, bigint[]> = {
  USD: [100n, 5000n, 10000n, 25000n, 50000n],
  JPY: [100n, 250n, 500n],
};

export function depositPresetMinorUnits(currency: string): bigint[] {
  const presets = DEPOSIT_PRESETS_MINOR[currency.toUpperCase()];
  if (presets) return presets;
  const min = depositMinimumMinor(currency);
  return [min, min * 50n, min * 100n, min * 250n, min * 500n];
}

export function depositAmountInputPolicy(currency: string) {
  const minimumMinor = depositMinimumMinor(currency);
  return {
    minimumMinor,
    minimumMajor: minorToMajorInputValue(minimumMinor, currency),
    minorUnitStep: minorToMajorInputValue(1n, currency),
  };
}

export function parseDepositAmountMinor(value: string, currency: string): bigint | null {
  if (!value.trim()) return null;
  try {
    const minor = majorToMinor(value, currency);
    return minor <= 0n ? null : minor;
  } catch {
    return null;
  }
}

function entryTone(entryType: string): Tone {
  if (entryType === 'credit') return 'ok';
  if (entryType === 'refund') return 'warn';
  return 'neutral';
}

export default function AdvertiserBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deposit flow state
  const [selectedMinor, setSelectedMinor] = useState<bigint | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [depositCurrency, setDepositCurrency] =
    useState<(typeof DEPOSIT_CURRENCIES)[number]['code']>('usd');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const displayDepositCurrency = depositCurrency.toUpperCase();
  const depositInputPolicy = depositAmountInputPolicy(displayDepositCurrency);

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

  const getDepositAmount = (): bigint | null => {
    if (showCustom) {
      return parseDepositAmountMinor(customAmount, displayDepositCurrency);
    }
    return selectedMinor;
  };

  const handleDeposit = async () => {
    const amountMinor = getDepositAmount();
    if (!amountMinor || amountMinor < depositInputPolicy.minimumMinor) return;

    setDepositing(true);
    setDepositError(null);

    try {
      const res = await advertiserApi.createDepositSession(amountMinor, depositCurrency);
      const { url } = res.data as { sessionId: string; url: string };
      // Redirect to the hosted checkout (Dodo Payments at launch — decision D1).
      window.location.assign(url);
    } catch (err: unknown) {
      setDepositError(getErrorMessage(err, 'Failed to create deposit session'));
      setDepositing(false);
    }
  };

  const validAmount = getDepositAmount();
  const canDeposit =
    validAmount !== null && validAmount >= depositInputPolicy.minimumMinor && !depositing;

  return (
    <>
      <PageHeader title="Billing" />

      {loading && !data && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {data && (
        <>
          {/* Stats cards */}
          <div className="dash-grid dash-grid--4">
            <Panel label="Account balance">
              <Stat
                label="Account balance"
                value={formatCurrency(data.balanceMinor, data.currency)}
              />
            </Panel>
            <Panel label="Total deposits">
              <Stat
                label="Total deposits"
                value={formatCurrency(data.totalDepositsMinor, data.currency)}
              />
            </Panel>
            <Panel label="Total charges">
              <Stat
                label="Total charges"
                value={formatCurrency(data.totalChargesMinor, data.currency)}
              />
            </Panel>
            <Panel label="Total refunds">
              <Stat
                label="Total refunds"
                value={formatCurrency(data.totalRefundsMinor ?? 0, data.currency)}
              />
            </Panel>
          </div>
          {data.balances && data.balances.length > 1 && (
            <Panel>
              <p className="dash-eyebrow mb-3">Balances by currency</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.balances.map((balance) => (
                  <div
                    key={balance.currency}
                    className="flex items-center justify-between rounded-xl border border-[var(--hair)] bg-[var(--page)] px-3 py-2"
                  >
                    <span className="text-sm text-[var(--copy)]">{balance.currency}</span>
                    <span className="dash-mono text-sm text-[var(--ink)]">
                      {formatCurrency(balance.balanceMinor, balance.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Deposit card */}
          <Panel label="Deposit funds">
            <PanelHeader title="Deposit funds" />
            <p className="mb-5 text-sm text-[var(--copy)]">
              Add funds to your account via Dodo Payments. Your balance is used to run ad campaigns.
            </p>

            <div className="mb-4">
              <label htmlFor="deposit-currency" className="mb-1.5 block">
                Deposit currency
              </label>
              <select
                id="deposit-currency"
                value={depositCurrency}
                onChange={(event) => {
                  setDepositCurrency(
                    event.target.value as (typeof DEPOSIT_CURRENCIES)[number]['code'],
                  );
                  setSelectedMinor(null);
                  setCustomAmount('');
                  setDepositError(null);
                }}
              >
                {DEPOSIT_CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount presets */}
            <div className="mb-4 flex flex-wrap gap-2">
              {depositPresetMinorUnits(depositCurrency).map((amount) => (
                <button
                  key={amount.toString()}
                  type="button"
                  onClick={() => {
                    setSelectedMinor(amount);
                    setShowCustom(false);
                    setCustomAmount('');
                    setDepositError(null);
                  }}
                  className={`dash-btn dash-btn--md ${
                    !showCustom && selectedMinor === amount
                      ? 'dash-btn--primary'
                      : 'dash-btn--secondary'
                  }`}
                >
                  {formatCurrency(amount, displayDepositCurrency)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowCustom(true);
                  setSelectedMinor(null);
                  setDepositError(null);
                }}
                className={`dash-btn dash-btn--md ${
                  showCustom ? 'dash-btn--primary' : 'dash-btn--secondary'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom amount input */}
            {showCustom && (
              <div className="mb-4">
                <div className="relative max-w-[200px]">
                  <span className="dash-mono pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--muted)]">
                    {displayDepositCurrency}
                  </span>
                  <input
                    type="number"
                    min={depositInputPolicy.minimumMajor}
                    step={depositInputPolicy.minorUnitStep}
                    placeholder="Amount"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setDepositError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canDeposit) handleDeposit();
                    }}
                    className="w-full pl-14"
                    aria-label={`Custom deposit amount in ${displayDepositCurrency}`}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </div>
                <p className="mt-1.5 text-xs text-[var(--muted)]">
                  Minimum deposit:{' '}
                  {formatCurrency(depositInputPolicy.minimumMinor, displayDepositCurrency)}
                </p>
              </div>
            )}

            {/* Deposit button */}
            <Button
              onClick={handleDeposit}
              disabled={!canDeposit}
              isLoading={depositing}
              variant="brand"
              size="md"
              className="w-full sm:w-auto"
            >
              {validAmount
                ? `Deposit ${formatCurrency(validAmount, displayDepositCurrency)} via Dodo Payments`
                : 'Select an amount to deposit'}
            </Button>

            {depositError && (
              <div className="mt-3">
                <Notice tone="bad">{depositError}</Notice>
              </div>
            )}

            <p className="mt-4 text-xs text-[var(--muted)]">
              Securely processed by Dodo Payments. Funds are available immediately after payment.
            </p>
          </Panel>

          {/* Transaction history */}
          <Panel label="Transaction history" flush>
            <PanelHeader title="Transaction history" />
            {data.entries.length === 0 ? (
              <div className="px-[22px] py-12 text-center text-sm text-[var(--muted)]">
                No transactions yet. Add funds to start running campaigns.
              </div>
            ) : (
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-label="Billing history table, scrolls horizontally"
              >
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="text-left">Date</th>
                      <th className="text-left">Description</th>
                      <th className="text-left">Type</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="text-xs">{formatRelativeTime(entry.createdAt)}</td>
                        <td>{entry.description || entry.entryType.replace(/_/g, ' ')}</td>
                        <td>
                          <Pill tone={entryTone(entry.entryType)}>
                            {entry.entryType.replace(/_/g, ' ')}
                          </Pill>
                        </td>
                        <td className="dash-mono text-right">
                          {entry.entryType === 'credit' ? '+' : '−'}
                          {formatCurrency(entry.amountMinor, entry.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
