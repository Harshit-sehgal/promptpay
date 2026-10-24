'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader, Pill, type Tone } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

interface MoneyIntegrityReport {
  timestamp: string;
  status: 'healthy' | 'unhealthy';
  globalReconciliation: {
    netAdvertiserSpendMinor: bigint;
    netDeveloperEarningsMinor: bigint;
    netPlatformFeeMinor: bigint;
    netReserveMinor: bigint;
    splitSumMinor: bigint;
    discrepancyMinor: bigint;
  };
  globalReconciliationByCurrency?: Record<
    string,
    {
      netAdvertiserSpendMinor: bigint;
      netDeveloperEarningsMinor: bigint;
      netPlatformFeeMinor: bigint;
      netReserveMinor: bigint;
      splitSumMinor: bigint;
      discrepancyMinor: bigint;
    }
  >;
  campaignDiscrepancies: Array<{
    campaignId: string;
    campaignName: string;
    budgetSpentMinor: bigint;
    ledgerDebits: bigint;
    diff: bigint;
    currency: string;
  }>;
  negativeDeveloperBalances: Array<{
    userId: string;
    email: string;
    balanceMinor: bigint;
    currency?: string;
  }>;
}

interface ToolIntegration {
  id: string;
  slug: string;
  name?: string | null;
  type?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface WebhookEvent {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  processingStatus: string;
  processedAt?: string | null;
  error?: string | null;
  createdAt: string;
}

interface WebhookEventsResponse {
  events: WebhookEvent[];
  total: number;
  page: number;
  limit: number;
}

interface ArchiveRefundObligation {
  id: string;
  advertiserId: string;
  campaignId?: string | null;
  stripePaymentIntentId?: string | null;
  amountMinor: bigint;
  currency: string;
  status: string;
  description?: string | null;
  createdAt: string;
  advertiser?: {
    id: string;
    companyName: string;
    billingEmail: string;
  } | null;
  campaign?: {
    id: string;
    name: string;
    status: string;
    archivedAt?: string | null;
  } | null;
}

function statusTone(status: string): Tone {
  if (status === 'healthy' || status === 'processed' || status === 'active') return 'ok';
  if (status === 'pending' || status === 'processing') return 'warn';
  return 'bad';
}

export default function AdminOperationsPage() {
  const [integrity, setIntegrity] = useState<MoneyIntegrityReport | null>(null);
  const [tools, setTools] = useState<ToolIntegration[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEventsResponse | null>(null);
  const [refunds, setRefunds] = useState<ArchiveRefundObligation[]>([]);
  const [webhookStatus, setWebhookStatus] = useState('');
  const [webhookProvider, setWebhookProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      adminApi.getMoneyIntegrity(),
      adminApi.getToolIntegrations(),
      adminApi.getWebhookEvents({
        page: 1,
        limit: 20,
        ...(webhookStatus ? { processingStatus: webhookStatus } : {}),
        ...(webhookProvider ? { provider: webhookProvider } : {}),
      }),
      adminApi.getPendingArchiveRefunds({ page: 1, limit: 100 }),
    ])
      .then(
        ([integrityRes, toolsRes, webhookRes, refundsRes]: [
          { data: MoneyIntegrityReport },
          { data: ToolIntegration[] },
          { data: WebhookEventsResponse },
          { data: { items: ArchiveRefundObligation[] } },
        ]) => {
          setIntegrity(integrityRes.data);
          setTools(toolsRes.data);
          setWebhooks(webhookRes.data);
          setRefunds(refundsRes.data.items);
        },
      )
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load operations data')))
      .finally(() => setLoading(false));
  }, [webhookProvider, webhookStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleTool = async (tool: ToolIntegration) => {
    setBusyTool(tool.slug);
    setError(null);
    try {
      await adminApi.toggleToolIntegration(tool.slug, !tool.isActive);
      await adminApi
        .getToolIntegrations()
        .then((res: { data: ToolIntegration[] }) => setTools(res.data));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Tool toggle failed'));
    } finally {
      setBusyTool(null);
    }
  };

  const campaignDiscrepancies = integrity?.campaignDiscrepancies ?? [];
  const negativeBalances = integrity?.negativeDeveloperBalances ?? [];
  const webhookEvents = webhooks?.events ?? [];
  const globalDiscrepancyByCurrency = integrity
    ? Object.fromEntries(
        Object.entries(
          integrity.globalReconciliationByCurrency ?? { USD: integrity.globalReconciliation },
        ).map(([currency, row]) => [currency, row.discrepancyMinor]),
      )
    : {};

  return (
    <>
      <PageHeader
        title="Operations"
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="dash-btn dash-btn--secondary dash-btn--md"
          >
            Refresh
          </button>
        }
      />

      {loading && <LoadingSpinner />}
      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {integrity && (
        <>
          <div className="dash-grid dash-grid--4">
            <StatCard
              label="Money integrity"
              value={integrity.status}
              subtitle={`Checked ${formatRelativeTime(integrity.timestamp)}`}
            />
            <StatCard
              label="Global discrepancy"
              value={formatCurrencyBreakdown(globalDiscrepancyByCurrency)}
            />
            <StatCard label="Campaign mismatches" value={String(campaignDiscrepancies.length)} />
            <StatCard label="Negative balances" value={String(negativeBalances.length)} />
            <StatCard
              label="Legacy refund rows"
              value={String(refunds.length)}
              subtitle="Reconciliation required"
            />
          </div>

          {(campaignDiscrepancies.length > 0 || negativeBalances.length > 0) && (
            <Notice tone="bad" title="Integrity exceptions">
              <div className="space-y-3">
                {campaignDiscrepancies.map((d) => (
                  <div key={d.campaignId} className="text-sm text-[var(--copy)]">
                    <span className="text-[var(--ink)]">{d.campaignName}</span>
                    <span className="text-[var(--muted)]">
                      {' '}
                      · budget spent {formatCurrency(d.budgetSpentMinor, d.currency)} · ledger{' '}
                      {formatCurrency(d.ledgerDebits, d.currency)} · diff{' '}
                    </span>
                    <span className="dash-mono text-[var(--ink)]">
                      {formatCurrency(d.diff, d.currency)}
                    </span>
                  </div>
                ))}
                {negativeBalances.map((b) => (
                  <div key={b.userId} className="text-sm text-[var(--copy)]">
                    <span className="text-[var(--ink)]">{b.email}</span>
                    <span className="text-[var(--muted)]"> · negative confirmed balance </span>
                    <span className="dash-mono text-[var(--ink)]">
                      {formatCurrency(b.balanceMinor, b.currency || 'USD')}
                    </span>
                  </div>
                ))}
              </div>
            </Notice>
          )}
        </>
      )}

      <Panel label="Legacy archive refund rows" flush>
        <PanelHeader
          title={
            <>
              Legacy archive refund rows
              <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                Read-only anomalies; reconcile against Stripe and webhook ledgers
              </span>
            </>
          }
          action={<span className="text-xs text-[var(--muted)]">{refunds.length} pending</span>}
        />

        {refunds.length === 0 ? (
          <p className="px-[22px] py-5 text-sm text-[var(--muted)]">
            No legacy archive refund rows require review.
          </p>
        ) : (
          <div className="dash-rows">
            {refunds.map((refund) => (
              <div key={refund.id}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">
                        {refund.campaign?.name || 'Archived campaign'}
                      </p>
                      <span className="dash-mono text-sm text-[var(--ink)]">
                        {formatCurrency(refund.amountMinor, refund.currency)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-[var(--copy)]">
                      {refund.advertiser?.companyName || refund.advertiserId}
                      {refund.advertiser?.billingEmail
                        ? ` · ${refund.advertiser.billingEmail}`
                        : ''}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Created {formatRelativeTime(refund.createdAt)}
                      {refund.campaign?.archivedAt
                        ? ` · archived ${formatRelativeTime(refund.campaign.archivedAt)}`
                        : ''}
                    </p>
                    {refund.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-[var(--copy)]">
                        {refund.description}
                      </p>
                    )}
                  </div>

                  <div className="max-w-md">
                    <Notice tone="warn">
                      Do not post this row. Verify the real Stripe refund and its signed webhook
                      ledger entries before manual reconciliation.
                    </Notice>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="dash-grid dash-grid--2">
        <Panel label="Tool integrations" flush>
          <PanelHeader
            title="Tool integrations"
            action={<span className="text-xs text-[var(--muted)]">{tools.length} configured</span>}
          />
          {tools.length === 0 ? (
            <p className="px-[22px] py-5 text-sm text-[var(--muted)]">
              No tool integrations configured.
            </p>
          ) : (
            <div className="dash-rows">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {tool.name || tool.slug}
                    </p>
                    <p className="truncate text-xs text-[var(--muted)]">{tool.type || tool.slug}</p>
                  </div>
                  <button
                    onClick={() => toggleTool(tool)}
                    disabled={busyTool === tool.slug}
                    className={`dash-btn dash-btn--sm ${
                      tool.isActive ? 'dash-btn--primary' : 'dash-btn--secondary'
                    }`}
                  >
                    {busyTool === tool.slug ? 'Saving...' : tool.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel label="Webhook events" flush>
          <PanelHeader
            title={
              <>
                Webhook events
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  {webhooks?.total ?? 0} total matching events
                </span>
              </>
            }
            action={
              <div className="flex gap-2">
                <input
                  value={webhookProvider}
                  onChange={(e) => setWebhookProvider(e.target.value)}
                  placeholder="provider"
                  className="w-28 px-3 py-2 text-xs"
                />
                <select
                  value={webhookStatus}
                  onChange={(e) => setWebhookStatus(e.target.value)}
                  className="px-3 py-2 text-xs"
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="processed">Processed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            }
          />

          {webhookEvents.length === 0 ? (
            <p className="px-[22px] py-5 text-sm text-[var(--muted)]">
              No webhook events match the current filters.
            </p>
          ) : (
            <div className="dash-rows">
              {webhookEvents.map((event) => (
                <div key={event.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">
                        {event.eventType}
                      </p>
                      <p className="dash-mono truncate text-xs text-[var(--muted)]">
                        {event.provider} · {event.eventId}
                      </p>
                    </div>
                    <Pill tone={statusTone(event.processingStatus)}>{event.processingStatus}</Pill>
                  </div>
                  {event.error && (
                    <p className="mt-2 line-clamp-2 text-xs text-[var(--copy)]">{event.error}</p>
                  )}
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Received {formatRelativeTime(event.createdAt)}
                    {event.processedAt
                      ? ` · processed ${formatRelativeTime(event.processedAt)}`
                      : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
