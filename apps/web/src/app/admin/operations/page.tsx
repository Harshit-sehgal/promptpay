'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatCard } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatCurrencyBreakdown, formatRelativeTime } from '@/lib/format';

interface MoneyIntegrityReport {
  timestamp: string;
  status: 'healthy' | 'unhealthy';
  globalReconciliation: {
    netAdvertiserSpendMinor: number;
    netDeveloperEarningsMinor: number;
    netPlatformFeeMinor: number;
    netReserveMinor: number;
    splitSumMinor: number;
    discrepancyMinor: number;
  };
  globalReconciliationByCurrency?: Record<string, {
    netAdvertiserSpendMinor: number;
    netDeveloperEarningsMinor: number;
    netPlatformFeeMinor: number;
    netReserveMinor: number;
    splitSumMinor: number;
    discrepancyMinor: number;
  }>;
  campaignDiscrepancies: Array<{
    campaignId: string;
    campaignName: string;
    budgetSpentMinor: number;
    ledgerDebits: number;
    diff: number;
    currency: string;
  }>;
  negativeDeveloperBalances: Array<{
    userId: string;
    email: string;
    balanceMinor: number;
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
  amountMinor: number;
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

function statusClass(status: string): string {
  if (status === 'healthy' || status === 'processed' || status === 'active') return 'text-emerald-400';
  if (status === 'pending' || status === 'processing') return 'text-amber-400';
  return 'text-red-400';
}

export default function AdminOperationsPage() {
  const [integrity, setIntegrity] = useState<MoneyIntegrityReport | null>(null);
  const [tools, setTools] = useState<ToolIntegration[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEventsResponse | null>(null);
  const [refunds, setRefunds] = useState<ArchiveRefundObligation[]>([]);
  const [refundInputs, setRefundInputs] = useState<Record<string, string>>({});
  const [webhookStatus, setWebhookStatus] = useState('');
  const [webhookProvider, setWebhookProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [busyRefund, setBusyRefund] = useState<string | null>(null);

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
      adminApi.getPendingArchiveRefunds(),
    ])
      .then(([integrityRes, toolsRes, webhookRes, refundsRes]: [
        { data: MoneyIntegrityReport },
        { data: ToolIntegration[] },
        { data: WebhookEventsResponse },
        { data: ArchiveRefundObligation[] },
      ]) => {
        setIntegrity(integrityRes.data);
        setTools(toolsRes.data);
        setWebhooks(webhookRes.data);
        setRefunds(refundsRes.data);
      })
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
      await adminApi.getToolIntegrations().then((res: { data: ToolIntegration[] }) => setTools(res.data));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Tool toggle failed'));
    } finally {
      setBusyTool(null);
    }
  };

  const confirmRefund = async (refund: ArchiveRefundObligation) => {
    const stripeRef = (refundInputs[refund.id] ?? '').trim();
    if (!stripeRef) {
      setError('Stripe refund payment_intent id is required');
      return;
    }

    setBusyRefund(refund.id);
    setError(null);
    try {
      await adminApi.confirmArchiveRefund(refund.id, stripeRef);
      setRefundInputs((current) => {
        const next = { ...current };
        delete next[refund.id];
        return next;
      });
      await adminApi
        .getPendingArchiveRefunds()
        .then((res: { data: ArchiveRefundObligation[] }) => setRefunds(res.data));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Archive refund confirmation failed'));
    } finally {
      setBusyRefund(null);
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
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Operations</h1>
          <p className="text-ink-300 text-sm">Money integrity, integrations, and webhook processing</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-ink-700 hover:bg-ink-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          Refresh
        </button>
      </div>

      {loading && <LoadingSpinner />}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {integrity && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-8">
            <StatCard
              label="Money integrity"
              value={integrity.status}
              valueColor={integrity.status === 'healthy' ? 'text-emerald-400' : 'text-red-400'}
              subtitle={`Checked ${formatRelativeTime(integrity.timestamp)}`}
            />
            <StatCard
              label="Global discrepancy"
              value={formatCurrencyBreakdown(globalDiscrepancyByCurrency)}
              valueColor={
                Object.values(globalDiscrepancyByCurrency).every((amountMinor) => amountMinor === 0)
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }
            />
            <StatCard
              label="Campaign mismatches"
              value={String(campaignDiscrepancies.length)}
              valueColor={campaignDiscrepancies.length === 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatCard
              label="Negative balances"
              value={String(negativeBalances.length)}
              valueColor={negativeBalances.length === 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatCard
              label="Archive refunds"
              value={String(refunds.length)}
              valueColor={refunds.length === 0 ? 'text-emerald-400' : 'text-amber-400'}
              subtitle="Pending confirmation"
            />
          </div>

          {(campaignDiscrepancies.length > 0 || negativeBalances.length > 0) && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 mb-8">
              <h2 className="text-red-300 font-semibold mb-4">Integrity exceptions</h2>
              <div className="space-y-3">
                {campaignDiscrepancies.map((d) => (
                  <div key={d.campaignId} className="text-sm text-ink-200">
                    <span className="text-white">{d.campaignName}</span>
                    <span className="text-ink-400"> · budget spent {formatCurrency(d.budgetSpentMinor, d.currency)} · ledger {formatCurrency(d.ledgerDebits, d.currency)} · diff </span>
                    <span className="text-red-300">{formatCurrency(d.diff, d.currency)}</span>
                  </div>
                ))}
                {negativeBalances.map((b) => (
                  <div key={b.userId} className="text-sm text-ink-200">
                    <span className="text-white">{b.email}</span>
                    <span className="text-ink-400"> · negative confirmed balance </span>
                    <span className="text-red-300">{formatCurrency(b.balanceMinor, b.currency || 'USD')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <section className="bg-ink-800 border border-ink-600/30 rounded-xl p-6 mb-8">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-white font-semibold">Archive refunds</h2>
            <p className="text-ink-400 text-xs">Manual Stripe refund obligations from archived campaigns</p>
          </div>
          <span className="text-ink-400 text-xs">{refunds.length} pending</span>
        </div>

        {refunds.length === 0 ? (
          <p className="text-ink-400 text-sm">No archive refund obligations are pending.</p>
        ) : (
          <div className="space-y-3">
            {refunds.map((refund) => (
              <div key={refund.id} className="border border-ink-700 rounded-lg p-4">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="text-white text-sm font-medium truncate">
                        {refund.campaign?.name || 'Archived campaign'}
                      </p>
                      <span className="text-amber-300 text-sm font-mono">
                        {formatCurrency(refund.amountMinor, refund.currency)}
                      </span>
                    </div>
                    <p className="text-ink-400 text-xs mt-1 truncate">
                      {refund.advertiser?.companyName || refund.advertiserId}
                      {refund.advertiser?.billingEmail ? ` · ${refund.advertiser.billingEmail}` : ''}
                    </p>
                    <p className="text-ink-500 text-xs mt-1">
                      Created {formatRelativeTime(refund.createdAt)}
                      {refund.campaign?.archivedAt ? ` · archived ${formatRelativeTime(refund.campaign.archivedAt)}` : ''}
                    </p>
                    {refund.description && (
                      <p className="text-ink-400 text-xs mt-2 line-clamp-2">{refund.description}</p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 xl:w-[28rem]">
                    <input
                      value={refundInputs[refund.id] ?? ''}
                      onChange={(event) =>
                        setRefundInputs((current) => ({ ...current, [refund.id]: event.target.value }))
                      }
                      placeholder="Stripe refund payment_intent"
                      className="min-w-0 flex-1 bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-2 text-xs text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
                    />
                    <button
                      onClick={() => confirmRefund(refund)}
                      disabled={busyRefund === refund.id}
                      className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg"
                    >
                      {busyRefund === refund.id ? 'Confirming...' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Tool integrations</h2>
            <span className="text-ink-400 text-xs">{tools.length} configured</span>
          </div>
          {tools.length === 0 ? (
            <p className="text-ink-400 text-sm">No tool integrations configured.</p>
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center justify-between gap-4 border border-ink-700 rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{tool.name || tool.slug}</p>
                    <p className="text-ink-400 text-xs truncate">{tool.type || tool.slug}</p>
                  </div>
                  <button
                    onClick={() => toggleTool(tool)}
                    disabled={busyTool === tool.slug}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 ${
                      tool.isActive
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                    }`}
                  >
                    {busyTool === tool.slug ? 'Saving...' : tool.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-ink-800 border border-ink-600/30 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-semibold">Webhook events</h2>
              <p className="text-ink-400 text-xs">{webhooks?.total ?? 0} total matching events</p>
            </div>
            <div className="flex gap-2">
              <input
                value={webhookProvider}
                onChange={(e) => setWebhookProvider(e.target.value)}
                placeholder="provider"
                className="w-28 bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-2 text-xs text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500"
              />
              <select
                value={webhookStatus}
                onChange={(e) => setWebhookStatus(e.target.value)}
                className="bg-ink-700 border border-ink-600/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="processed">Processed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {webhookEvents.length === 0 ? (
            <p className="text-ink-400 text-sm">No webhook events match the current filters.</p>
          ) : (
            <div className="space-y-3">
              {webhookEvents.map((event) => (
                <div key={event.id} className="border border-ink-700 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{event.eventType}</p>
                      <p className="text-ink-400 text-xs truncate">{event.provider} · {event.eventId}</p>
                    </div>
                    <span className={`text-xs font-medium ${statusClass(event.processingStatus)}`}>
                      {event.processingStatus}
                    </span>
                  </div>
                  {event.error && <p className="text-red-300 text-xs mt-2 line-clamp-2">{event.error}</p>}
                  <p className="text-ink-500 text-xs mt-2">
                    Received {formatRelativeTime(event.createdAt)}
                    {event.processedAt ? ` · processed ${formatRelativeTime(event.processedAt)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
