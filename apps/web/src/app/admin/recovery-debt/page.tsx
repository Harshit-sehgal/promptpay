'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { Notice, PageHeader, Panel, Pill, Stat, type Tone } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

/**
 * Strictly parse the "min cents" filter: empty or non-numeric input means
 * "no filter" (`undefined`), never a silent `1` — the previous
 * `Number(value) || 1` coerced a half-typed or zero input into a minimum of
 * 1 cent and refetched on every keystroke.
 */
function parseMinAmountMinor(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.floor(parsed));
}

/** Debounce a fast-changing value (min-amount input) before it drives fetches. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type RecoveryDebtCaseStatus = 'open' | 'in_collections' | 'recovered' | 'written_off' | 'closed';

interface RecoveryDebtCase {
  id: string;
  userId: string;
  status: RecoveryDebtCaseStatus;
  amountMinor: bigint;
  currency: string;
  externalReference?: string | null;
  note?: string | null;
  updatedAt?: string;
}

interface RecoveryDebtRow {
  userId: string;
  currency: string;
  confirmedDebitMinor: bigint;
  confirmedCreditMinor: bigint;
  outstandingDebtMinor: bigint;
  recoveryDebitEntryCount: number;
  user?: {
    email?: string | null;
    name?: string | null;
    status?: string;
    trustLevel?: string;
  } | null;
  latestCase?: RecoveryDebtCase | null;
}

interface RecoveryDebtResponse {
  items: RecoveryDebtRow[];
  total: number;
  page: number;
  limit: number;
}

type ActionState =
  | { mode: 'open'; row: RecoveryDebtRow; status: 'open' | 'in_collections' }
  | {
      mode: 'resolve';
      row: RecoveryDebtRow;
      caseId: string;
      status: 'recovered' | 'written_off' | 'closed';
    };

const ACTIVE_CASE_STATUSES = new Set<RecoveryDebtCaseStatus>(['open', 'in_collections']);

function caseTone(status?: RecoveryDebtCaseStatus): Tone {
  switch (status) {
    case 'open':
      return 'warn';
    case 'in_collections':
      return 'bad';
    case 'recovered':
      return 'ok';
    default:
      return 'neutral';
  }
}

function formatStatus(status?: string | null) {
  return status ? status.replace(/_/g, ' ') : 'no case';
}

export default function AdminRecoveryDebtPage() {
  const [data, setData] = useState<RecoveryDebtResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [minAmountMinor, setMinAmountMinor] = useState('');
  const [currency, setCurrency] = useState('');
  const [action, setAction] = useState<ActionState | null>(null);
  const [externalReference, setExternalReference] = useState('');
  const [note, setNote] = useState('');
  const [processing, setProcessing] = useState(false);

  // Debounce the min-amount keystrokes so a full 400ms pause is needed
  // before a fetch fires (typing "1234" no longer issues 4 requests).
  const debouncedMinAmountMinor = useDebouncedValue(minAmountMinor, 400);

  const params = useMemo(
    () => ({
      page,
      limit: 25,
      minAmountMinor: parseMinAmountMinor(debouncedMinAmountMinor),
      currency: currency.trim() || undefined,
    }),
    [currency, debouncedMinAmountMinor, page],
  );

  const fetchDebt = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getRecoveryDebtCases(params)
      .then((res: { data: RecoveryDebtResponse }) => setData(res.data))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load recovery debt')))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    fetchDebt();
  }, [fetchDebt]);

  const openAction = (next: ActionState) => {
    setAction(next);
    setExternalReference(next.row.latestCase?.externalReference || '');
    setNote(next.row.latestCase?.note || '');
  };

  const submitAction = async () => {
    if (!action) return;
    setProcessing(true);
    setError(null);
    try {
      if (action.mode === 'open') {
        await adminApi.openRecoveryDebtCase(action.row.userId, {
          status: action.status,
          currency: action.row.currency,
          externalReference: externalReference || undefined,
          note: note || undefined,
        });
      } else {
        await adminApi.resolveRecoveryDebtCase(action.caseId, {
          status: action.status,
          externalReference: externalReference || undefined,
          note: note || undefined,
        });
      }
      setAction(null);
      setExternalReference('');
      setNote('');
      fetchDebt();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Recovery debt action failed'));
    } finally {
      setProcessing(false);
    }
  };

  const items = data?.items || [];
  const outstandingByCurrency = items.reduce<Record<string, bigint>>((totals, row) => {
    totals[row.currency] = (totals[row.currency] ?? 0n) + row.outstandingDebtMinor;
    return totals;
  }, {});
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Recovery debt"
        lede="Track paid-fraud recovery debt that has not been netted from future earnings."
      />

      <Panel label="Recovery debt summary">
        <div className="dash-grid dash-grid--4">
          <Stat label="Rows shown" value={items.length} />
          <Stat label="Total matching" value={data?.total ?? 0} />
          <Stat
            label="Shown outstanding"
            value={
              <span className="break-words">{formatCurrencyBreakdown(outstandingByCurrency)}</span>
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="dash-eyebrow">Min cents</span>
              <input
                value={minAmountMinor}
                onChange={(e) => {
                  setPage(1);
                  setMinAmountMinor(e.target.value);
                }}
                inputMode="numeric"
                className="mt-2 w-full px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="dash-eyebrow">Currency</span>
              <input
                value={currency}
                onChange={(e) => {
                  setPage(1);
                  setCurrency(e.target.value.toUpperCase());
                }}
                maxLength={3}
                placeholder="ALL"
                className="mt-2 w-full px-3 py-2 text-sm uppercase"
              />
            </label>
          </div>
        </div>
      </Panel>

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {!loading && items.length === 0 ? (
        <Panel label="No recovery debt">
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            No outstanding recovery debt matches these filters.
          </p>
        </Panel>
      ) : (
        <Panel label="Recovery debt cases" flush>
          <div className="dash-rows">
            {items.map((row) => {
              const latestCase = row.latestCase;
              const activeCase = latestCase && ACTIVE_CASE_STATUSES.has(latestCase.status);
              return (
                <div key={`${row.userId}:${row.currency}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-[var(--ink)]">
                          {row.user?.email || row.userId}
                        </p>
                        <Pill tone={caseTone(latestCase?.status)}>
                          <span className="capitalize">{formatStatus(latestCase?.status)}</span>
                        </Pill>
                        <span className="dash-mono text-xs uppercase text-[var(--muted)]">
                          {row.currency}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--copy)]">
                        {row.recoveryDebitEntryCount} recovery debit entries
                        <span className="mx-2">·</span>
                        User status {row.user?.status || 'unknown'}
                        <span className="mx-2">·</span>
                        Trust {formatStatus(row.user?.trustLevel)}
                      </p>
                      {latestCase && (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Case {latestCase.id}
                          {latestCase.updatedAt
                            ? ` · updated ${formatRelativeTime(latestCase.updatedAt)}`
                            : ''}
                          {latestCase.externalReference ? ` · ${latestCase.externalReference}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                      <div>
                        <p className="dash-eyebrow">Debits</p>
                        <p className="dash-mono text-[var(--ink)]">
                          {formatCurrency(row.confirmedDebitMinor, row.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="dash-eyebrow">Credits</p>
                        <p className="dash-mono text-[var(--ink)]">
                          {formatCurrency(row.confirmedCreditMinor, row.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="dash-eyebrow">Outstanding</p>
                        <p className="dash-mono font-semibold text-[var(--ink)]">
                          {formatCurrency(row.outstandingDebtMinor, row.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      <button
                        onClick={() =>
                          openAction({
                            mode: 'open',
                            row,
                            status: activeCase
                              ? (latestCase.status as 'open' | 'in_collections')
                              : 'open',
                          })
                        }
                        className="dash-btn dash-btn--glass dash-btn--sm"
                      >
                        {activeCase ? 'Update case' : 'Open case'}
                      </button>
                      <button
                        onClick={() => openAction({ mode: 'open', row, status: 'in_collections' })}
                        className="dash-btn dash-btn--danger dash-btn--sm"
                      >
                        Collections
                      </button>
                      {activeCase && (
                        <>
                          <button
                            onClick={() =>
                              openAction({
                                mode: 'resolve',
                                row,
                                caseId: latestCase.id,
                                status: 'recovered',
                              })
                            }
                            className="dash-btn dash-btn--primary dash-btn--sm"
                          >
                            Recovered
                          </button>
                          <button
                            onClick={() =>
                              openAction({
                                mode: 'resolve',
                                row,
                                caseId: latestCase.id,
                                status: 'written_off',
                              })
                            }
                            className="dash-btn dash-btn--glass dash-btn--sm"
                          >
                            Write off
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="dash-btn dash-btn--glass dash-btn--md"
          >
            Previous
          </button>
          <p className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </p>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="dash-btn dash-btn--glass dash-btn--md"
          >
            Next
          </button>
        </div>
      )}

      {action && (
        <ModalDialog
          open
          onClose={() => setAction(null)}
          labelledBy="admin-recovery-action-title"
          className="max-w-lg"
        >
          <h3
            id="admin-recovery-action-title"
            className="mb-2 font-semibold capitalize text-[var(--ink)]"
          >
            {action.mode === 'open'
              ? `${formatStatus(action.status)} case`
              : `${formatStatus(action.status)} case`}
          </h3>
          <p className="mb-4 text-sm text-[var(--copy)]">
            {action.row.user?.email || action.row.userId} ·{' '}
            {formatCurrency(action.row.outstandingDebtMinor, action.row.currency)} outstanding
          </p>
          <label className="mb-3 block">
            <span className="dash-eyebrow">External reference</span>
            <input
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              maxLength={255}
              className="mt-2 w-full px-4 py-3"
            />
          </label>
          <label className="mb-5 block">
            <span className="dash-eyebrow">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={4}
              className="mt-2 w-full px-4 py-3"
            />
          </label>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setAction(null)}
              className="dash-btn dash-btn--glass dash-btn--md"
            >
              Cancel
            </button>
            <button
              onClick={submitAction}
              disabled={processing}
              className="dash-btn dash-btn--primary dash-btn--md"
            >
              {processing ? 'Saving...' : 'Save'}
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
