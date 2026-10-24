'use client';

import { useEffect, useState } from 'react';
import { Notice, Panel, PanelHeader, Pill } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { sandboxApi } from '@/lib/api/services';

type Deposit = {
  id: string;
  amountMinor: string;
  currency: string;
  requestedOutcome: string;
  status: string;
  providerTxId: string;
  createdAt: string;
};

const outcomes = [
  'approved',
  'processing',
  'declined',
  'refunded',
  'disputed',
  'timeout',
  'duplicate_callback',
  'delayed_callback',
  'callback_before_response',
  'currency_mismatch',
  'amount_mismatch',
] as const;

function idempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `web-deposit-${random}`;
}

function formatXts(minor: string | number): string {
  return `${(Number(minor) / 100).toFixed(2)} XTS`;
}

export default function SandboxDepositPanel() {
  const [enabled, setEnabled] = useState(false);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [amount, setAmount] = useState('10000');
  const [outcome, setOutcome] = useState<(typeof outcomes)[number]>('approved');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const healthResponse = await fetch('/api/platform-health', { cache: 'no-store' });
        if (!healthResponse.ok) return;
        const health = (await healthResponse.json()) as { environmentKind?: string };
        if (health.environmentKind !== 'sandbox' && health.environmentKind !== 'test') return;
        setEnabled(true);
        const response = await sandboxApi.listDeposits();
        setDeposits((response.data.deposits ?? []) as Deposit[]);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Sandbox deposits are unavailable'));
      }
    };
    void load();
  }, []);

  if (!enabled) return null;

  const simulate = async () => {
    const amountMinor = Number(amount);
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 1_000_000) {
      setError('Enter a whole-number amount from 1 to 1,000,000 minor XTS.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await sandboxApi.simulateDeposit({
        amountMinor,
        outcome,
        idempotencyKey: idempotencyKey(),
      });
      setNotice(
        response.data.duplicate
          ? 'That deposit simulation was already applied.'
          : `Simulation recorded as ${response.data.status}. No external transfer occurred.`,
      );
      const listResponse = await sandboxApi.listDeposits();
      setDeposits((listResponse.data.deposits ?? []) as Deposit[]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not simulate sandbox deposit'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel label="Sandbox advertiser deposits">
      <PanelHeader title="Test advertiser deposit" action={<Pill tone="warn">Sandbox only</Pill>} />
      <p className="text-sm leading-6 text-[var(--copy)]">
        XTS only. Simulated provider outcomes, no cash value or external transfer.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label>
          Amount (minor XTS)
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            className="mt-1 w-full"
          />
        </label>
        <label>
          Provider outcome
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as (typeof outcomes)[number])}
            className="mt-1 w-full"
          >
            {outcomes.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void simulate()}
          className="dash-btn dash-btn--primary dash-btn--md"
        >
          Record deposit
        </button>
      </div>
      {(error || notice) && (
        <div className="mt-3">
          <Notice tone={error ? 'bad' : 'ok'}>{error ?? notice}</Notice>
        </div>
      )}
      {deposits.length > 0 && (
        <div className="mt-4 border-t border-[var(--hair)] pt-3">
          <p className="dash-eyebrow">Recent simulations</p>
          <div className="mt-2 space-y-1 text-sm text-[var(--ink)]">
            {deposits.slice(0, 5).map((deposit) => (
              <div key={deposit.id} className="flex justify-between gap-3">
                <span className="dash-mono">{formatXts(deposit.amountMinor)}</span>
                <span>{deposit.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
