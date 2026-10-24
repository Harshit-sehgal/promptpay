'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, Pill } from '@/components/dash';
import ModalDialog from '@/components/ui/modal-dialog';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, campaignApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface Creative {
  id: string;
  sponsoredMessage: string;
  displayDomain: string;
  destinationUrl: string;
  status: string;
}

interface PendingCampaign {
  id: string;
  title: string;
  name?: string;
  advertiserEmail?: string;
  advertiser?: { companyName: string };
  category: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  submittedAt: string;
  landingUrl?: string;
  creatives: Creative[];
}

interface PendingCampaignsResponse {
  items: PendingCampaign[];
  total: number;
  page: number;
  limit: number;
}

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<PendingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectModalFor, setRejectModalFor] = useState<PendingCampaign | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [creativeRejectFor, setCreativeRejectFor] = useState<Creative | null>(null);
  const [creativeRejectReason, setCreativeRejectReason] = useState('');
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      // A-077: use the bounded, paginated pending-campaigns endpoint so the
      // approval queue stays usable with a large backlog.
      const res: { data: PendingCampaignsResponse } = await adminApi.getPendingCampaigns({
        page,
        limit,
      });
      setCampaigns(res.data.items);
      setTotal(res.data.total);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await adminApi.approveCampaign(id);
      fetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Approve failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModalFor || !rejectReason.trim()) return;
    setProcessing(rejectModalFor.id);
    try {
      await adminApi.rejectCampaign(rejectModalFor.id, rejectReason);
      setRejectModalFor(null);
      setRejectReason('');
      fetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Reject failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleApproveCreative = async (creativeId: string) => {
    setProcessing(creativeId);
    try {
      await campaignApi.approveCreative(creativeId);
      fetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Creative approve failed'));
    } finally {
      setProcessing(null);
    }
  };

  const handleRejectCreativeConfirm = async () => {
    if (!creativeRejectFor || !creativeRejectReason.trim()) return;
    setProcessing(creativeRejectFor.id);
    try {
      await campaignApi.rejectCreative(creativeRejectFor.id, creativeRejectReason.trim());
      setCreativeRejectFor(null);
      setCreativeRejectReason('');
      fetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Creative reject failed'));
    } finally {
      setProcessing(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Campaign approvals"
        lede="Review campaigns and their creatives before activation"
      />

      {loading && <LoadingSpinner />}
      {error && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={() => setError(null)}
              className="dash-btn dash-btn--ghost dash-btn--sm"
            >
              Dismiss
            </button>
          }
        >
          {error}
        </Notice>
      )}

      {campaigns.length === 0 && !loading ? (
        <Panel label="No campaigns awaiting review">
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            No campaigns awaiting review.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-5">
          {campaigns.map((c) => (
            <Panel key={c.id} label={c.title || c.name}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={c.status} />
                  <h3 className="font-medium text-[var(--ink)]">{c.title || c.name}</h3>
                  <span className="text-xs text-[var(--muted)] capitalize">
                    {c.category?.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <button
                    onClick={() => setRejectModalFor(c)}
                    disabled={processing === c.id}
                    className="dash-btn dash-btn--glass dash-btn--sm"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(c.id)}
                    disabled={processing === c.id}
                    className="dash-btn dash-btn--primary dash-btn--sm"
                  >
                    {processing === c.id ? 'Processing...' : 'Approve Campaign'}
                  </button>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs text-[var(--muted)]">Advertiser</p>
                  <p className="text-xs text-[var(--ink)]">
                    {c.advertiser?.companyName || c.advertiserEmail || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)]">Bid</p>
                  <p className="dash-mono text-[var(--ink)]">
                    {formatCurrency(c.bidAmountMinor, c.currency)}/
                    {c.bidType === 'cpm' ? '1k imp' : 'click'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)]">Budget</p>
                  <p className="dash-mono text-[var(--ink)]">
                    {formatCurrency(c.budgetTotalMinor, c.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)]">Submitted</p>
                  <p className="text-xs text-[var(--copy)]">
                    {formatRelativeTime(c.submittedAt || c.createdAt)}
                  </p>
                </div>
              </div>

              {/* Creatives section */}
              {c.creatives && c.creatives.length > 0 && (
                <div className="mt-3 border-t border-[var(--hair)] pt-3">
                  <button
                    onClick={() => setExpandedCampaign(expandedCampaign === c.id ? null : c.id)}
                    aria-expanded={expandedCampaign === c.id}
                    aria-controls={`creative-list-${c.id}`}
                    className="mb-2 flex items-center gap-1 text-xs font-medium text-[var(--ink)]"
                  >
                    {expandedCampaign === c.id ? '▼' : '▶'} {c.creatives.length} creative
                    {c.creatives.length !== 1 ? 's' : ''}
                    <span className="ml-1 text-[var(--muted)]">
                      ({c.creatives.filter((cr) => cr.status === 'approved').length} approved,{' '}
                      {c.creatives.filter((cr) => cr.status === 'pending_review').length} pending)
                    </span>
                  </button>

                  {expandedCampaign === c.id && (
                    <div id={`creative-list-${c.id}`} className="mt-2 space-y-2">
                      {c.creatives.map((cr) => (
                        <div
                          key={cr.id}
                          className="flex items-center justify-between rounded-xl border border-[var(--hair)] bg-[var(--glass-strong)] p-3"
                        >
                          <div className="mr-4 min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <StatusBadge status={cr.status} />
                              <span className="truncate text-xs text-[var(--copy)]">
                                {cr.displayDomain}
                              </span>
                            </div>
                            <p className="truncate text-xs text-[var(--ink)]">
                              {cr.sponsoredMessage}
                            </p>
                            <a
                              href={
                                /^https?:\/\//i.test(cr.destinationUrl ?? '')
                                  ? cr.destinationUrl
                                  : '#'
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-0.5 block truncate text-xs text-[var(--ink)] underline"
                            >
                              {cr.destinationUrl}
                            </a>
                          </div>
                          {(cr.status === 'pending_review' || cr.status === 'draft') && (
                            <div className="flex flex-shrink-0 items-center gap-2">
                              <button
                                onClick={() => {
                                  setCreativeRejectFor(cr);
                                  setCreativeRejectReason('');
                                }}
                                disabled={processing === cr.id}
                                className="dash-btn dash-btn--glass dash-btn--sm"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => handleApproveCreative(cr.id)}
                                disabled={processing === cr.id}
                                className="dash-btn dash-btn--primary dash-btn--sm"
                              >
                                {processing === cr.id ? '...' : 'Approve'}
                              </button>
                            </div>
                          )}
                          {cr.status === 'approved' && <Pill tone="ok">✓ Approved</Pill>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/* Campaign reject modal */}
      {rejectModalFor && (
        <ModalDialog
          open
          onClose={() => {
            setRejectModalFor(null);
            setRejectReason('');
          }}
          labelledBy="admin-reject-campaign-title"
        >
          <h3 id="admin-reject-campaign-title" className="mb-2 font-semibold text-[var(--ink)]">
            Reject campaign
          </h3>
          <p className="mb-4 text-sm text-[var(--muted)]">
            <span className="text-[var(--ink)]">{rejectModalFor.title || rejectModalFor.name}</span>
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (required) — visible to advertiser"
            rows={3}
            required
            className="mb-4 w-full px-4 py-3"
          />
          <div className="flex items-center gap-3 justify-end">
            <button
              onClick={() => {
                setRejectModalFor(null);
                setRejectReason('');
              }}
              className="dash-btn dash-btn--glass dash-btn--md"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={!rejectReason.trim() || processing === rejectModalFor.id}
              className="dash-btn dash-btn--danger dash-btn--md"
            >
              Reject
            </button>
          </div>
        </ModalDialog>
      )}

      {/* Creative reject modal */}
      {creativeRejectFor && (
        <ModalDialog
          open
          onClose={() => {
            setCreativeRejectFor(null);
            setCreativeRejectReason('');
          }}
          labelledBy="admin-reject-creative-title"
        >
          <h3 id="admin-reject-creative-title" className="mb-2 font-semibold text-[var(--ink)]">
            Reject creative
          </h3>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Domain: <span className="text-[var(--ink)]">{creativeRejectFor.displayDomain}</span>
          </p>
          <p className="mb-4 truncate text-xs text-[var(--ink)]">
            {creativeRejectFor.sponsoredMessage}
          </p>
          <textarea
            value={creativeRejectReason}
            onChange={(e) => setCreativeRejectReason(e.target.value)}
            placeholder="Reason (required) — visible to advertiser"
            rows={3}
            required
            className="mb-4 w-full px-4 py-3"
          />
          <div className="flex items-center gap-3 justify-end">
            <button
              onClick={() => {
                setCreativeRejectFor(null);
                setCreativeRejectReason('');
              }}
              className="dash-btn dash-btn--glass dash-btn--md"
            >
              Cancel
            </button>
            <button
              onClick={handleRejectCreativeConfirm}
              disabled={!creativeRejectReason.trim() || processing === creativeRejectFor.id}
              className="dash-btn dash-btn--danger dash-btn--md"
            >
              Reject
            </button>
          </div>
        </ModalDialog>
      )}

      {/* Pagination (A-077) */}
      {total > limit && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="dash-btn dash-btn--glass dash-btn--md"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {Math.max(1, Math.ceil(total / limit))}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / limit)}
            className="dash-btn dash-btn--glass dash-btn--md"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
