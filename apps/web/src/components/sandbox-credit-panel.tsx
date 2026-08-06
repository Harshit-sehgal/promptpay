'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { sandboxApi } from '@/lib/api/services';

type CreditResponse = {
  mode: 'sandbox';
  hasCashValue: false;
  currency: string;
  balanceMinor: string;
  grantedMinor?: number;
  label: string;
};

type Payout = {
  id: string;
  amountMinor: string;
  currency: string;
  destinationAlias: string;
  requestedOutcome: string;
  status: string;
  createdAt: string;
};

const outcomes = [
  'paid',
  'processing',
  'failed',
  'ambiguous',
  'reversed',
  'callback_before_response',
  'duplicate_callback',
  'timeout',
  'reconciliation_escalation',
] as const;

function idempotencyKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function formatXts(minor: string | number): string {
  return `${(Number(minor) / 100).toFixed(2)} XTS`;
}

export default function SandboxCreditPanel() {
  const [enabled, setEnabled] = useState(false);
  const [credits, setCredits] = useState<CreditResponse | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [amount, setAmount] = useState('1000');
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]>('paid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const healthResponse = await fetch('/api/platform-health', { cache: 'no-store' });
      if (!healthResponse.ok) return;
      const health = (await healthResponse.json()) as { environmentKind?: string };
      if (health.environmentKind !== 'sandbox' && health.environmentKind !== 'test') return;
      setEnabled(true);
      const [creditResponse, payoutResponse] = await Promise.all([
        sandboxApi.getCredits(),
        sandboxApi.listPayouts(),
      ]);
      setCredits(creditResponse.data as CreditResponse);
      setPayouts((payoutResponse.data.payouts ?? []) as Payout[]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Sandbox credits are unavailable'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!enabled) return null;

  const claimFaucet = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await sandboxApi.claimFaucet(idempotencyKey('web-faucet'));
      setCredits(response.data as CreditResponse);
      setNotice(
        response.data.duplicate ? 'That faucet request was already applied.' : '10,000 XTS added.',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not claim sandbox credits'));
    } finally {
      setBusy(false);
    }
  };

  const simulatePayout = async () => {
    const amountMinor = Number(amount);
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 100_000) {
      setError('Enter a whole-number amount from 1 to 100,000 minor XTS.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await sandboxApi.simulatePayout({
        amountMinor,
        destinationAlias: 'sandbox:web-dashboard',
        outcome,
        idempotencyKey: idempotencyKey('web-payout'),
      });
      setCredits((current) =>
        current ? { ...current, balanceMinor: response.data.balanceMinor } : current,
      );
      setNotice(`Simulation recorded as ${response.data.status}. No external transfer occurred.`);
      const payoutResponse = await sandboxApi.listPayouts();
      setPayouts((payoutResponse.data.payouts ?? []) as Payout[]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not simulate sandbox payout'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Sandbox test credits"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 shadow-sm"
    >
      <div className="border-b border-amber-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
          Sandbox only
        </p>
        <h2 className="mt-1 text-lg font-semibold text-amber-950">
          Test credits and payout simulation
        </h2>
        <p className="mt-1 text-sm leading-6 text-amber-900">
          XTS only — no cash value, no external transfer.
        </p>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Balance</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-amber-950">
            {credits ? formatXts(credits.balanceMinor) : '—'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void claimFaucet()}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-amber-800 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Claim faucet grant
          </button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-white p-4">
          <p className="text-sm font-semibold text-surface-950">Simulate a payout outcome</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-surface-600">
              Amount (minor XTS)
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="mt-1 h-10 w-full rounded-lg border border-surface-200 px-3 text-sm text-surface-950"
              />
            </label>
            <label className="text-xs font-medium text-surface-600">
              Requested outcome
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as (typeof outcomes)[number])}
                className="mt-1 h-10 w-full rounded-lg border border-surface-200 bg-white px-3 text-sm text-surface-950"
              >
                {outcomes.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void simulatePayout()}
            className="mt-3 inline-flex h-10 items-center rounded-lg border border-surface-300 px-4 text-sm font-medium text-surface-800 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Record simulation
          </button>
        </div>
      </div>
      {(error || notice) && (
        <p
          className={`border-t px-5 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}
        >
          {error ?? notice}
        </p>
      )}
      {payouts.length > 0 && (
        <div className="border-t border-amber-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Recent simulations
          </p>
          <div className="mt-2 divide-y divide-surface-100">
            {payouts.slice(0, 5).map((payout) => (
              <div
                key={payout.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-mono text-surface-700">{formatXts(payout.amountMinor)}</span>
                <span className="text-surface-600">{payout.status}</span>
                <span className="text-xs text-surface-500">{payout.destinationAlias}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
