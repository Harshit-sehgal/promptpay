'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
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

type PendingCampaignsResponse = PendingCampaign[] | { campaigns?: PendingCampaign[] };

function normalizeCampaigns(data: PendingCampaignsResponse): PendingCampaign[] {
  return Array.isArray(data) ? data : data.campaigns || [];
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

  const fetchCampaigns = useCallback(() => {
    setLoading(true);
    adminApi.getPendingCampaigns()
      .then((res: { data: PendingCampaignsResponse }) => setCampaigns(normalizeCampaigns(res.data)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load campaigns')))
      .finally(() => setLoading(false));
  }, []);

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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Campaign approvals</h1>
          <p className="text-ink-300 text-sm">Review campaigns and their creatives before activation</p>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={() => setError(null)} className="text-red-300 text-xs mt-1 underline">Dismiss</button>
          </div>
        )}

        {campaigns.length === 0 && !loading ? (
          <div className="bg-ink-800 border border-ink-600/30 rounded-xl p-12 text-center">
            <p className="text-ink-400 text-sm">No campaigns awaiting review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="bg-ink-800 border border-ink-600/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={c.status} />
                    <h3 className="text-white font-medium">{c.title || c.name}</h3>
                    <span className="text-ink-500 text-xs capitalize">{c.category?.replace('_', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRejectModalFor(c)}
                      disabled={processing === c.id}
                      className="bg-ink-700 hover:bg-ink-600 text-red-400 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(c.id)}
                      disabled={processing === c.id}
                      className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {processing === c.id ? 'Processing...' : 'Approve Campaign'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                  <div>
                    <p className="text-ink-500 text-xs">Advertiser</p>
                    <p className="text-white text-xs">{c.advertiser?.companyName || c.advertiserEmail || '—'}</p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Bid</p>
                    <p className="text-white font-mono">
                      {formatCurrency(c.bidAmountMinor, c.currency)}/{c.bidType === 'cpm' ? '1k imp' : 'click'}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Budget</p>
                    <p className="text-white font-mono">{formatCurrency(c.budgetTotalMinor, c.currency)}</p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Submitted</p>
                    <p className="text-ink-300 text-xs">{formatRelativeTime(c.submittedAt || c.createdAt)}</p>
                  </div>
                </div>

                {/* Creatives section */}
                {c.creatives && c.creatives.length > 0 && (
                  <div className="border-t border-ink-600/30 pt-3 mt-3">
                    <button
                      onClick={() => setExpandedCampaign(expandedCampaign === c.id ? null : c.id)}
                      className="text-brand-400 hover:text-brand-300 text-xs font-medium mb-2 flex items-center gap-1"
                    >
                      {expandedCampaign === c.id ? '▼' : '▶'} {c.creatives.length} creative{c.creatives.length !== 1 ? 's' : ''}
                      <span className="text-ink-500 ml-1">
                        ({c.creatives.filter(cr => cr.status === 'approved').length} approved,{' '}
                        {c.creatives.filter(cr => cr.status === 'pending_review').length} pending)
                      </span>
                    </button>

                    {expandedCampaign === c.id && (
                      <div className="space-y-2 mt-2">
                        {c.creatives.map((cr) => (
                          <div
                            key={cr.id}
                            className="bg-ink-700/50 border border-ink-600/20 rounded-lg p-3 flex items-center justify-between"
                          >
                            <div className="flex-1 min-w-0 mr-4">
                              <div className="flex items-center gap-2 mb-1">
                                <StatusBadge status={cr.status} />
                                <span className="text-ink-300 text-xs truncate">{cr.displayDomain}</span>
                              </div>
                              <p className="text-white text-xs truncate">{cr.sponsoredMessage}</p>
                              <a
                                href={cr.destinationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-500 hover:text-brand-400 text-xs truncate block mt-0.5"
                              >
                                {cr.destinationUrl}
                              </a>
                            </div>
                            {(cr.status === 'pending_review' || cr.status === 'draft') && (
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setCreativeRejectFor(cr);
                                    setCreativeRejectReason('');
                                  }}
                                  disabled={processing === cr.id}
                                  className="bg-ink-600 hover:bg-ink-500 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Reject
                                </button>
                                <button
                                  onClick={() => handleApproveCreative(cr.id)}
                                  disabled={processing === cr.id}
                                  className="bg-emerald-500/80 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  {processing === cr.id ? '...' : 'Approve'}
                                </button>
                              </div>
                            )}
                            {cr.status === 'approved' && (
                              <span className="text-emerald-400 text-xs font-medium px-3 py-1.5">✓ Approved</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Campaign reject modal */}
        {rejectModalFor && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
            <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-white font-semibold mb-2">Reject campaign</h3>
              <p className="text-ink-400 text-sm mb-4">
                <span className="text-white">{rejectModalFor.title || rejectModalFor.name}</span>
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (required) — visible to advertiser"
                rows={3}
                required
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 mb-4"
              />
              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={() => {
                    setRejectModalFor(null);
                    setRejectReason('');
                  }}
                  className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || processing === rejectModalFor.id}
                  className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Creative reject modal */}
        {creativeRejectFor && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
            <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-white font-semibold mb-2">Reject creative</h3>
              <p className="text-ink-400 text-sm mb-4">
                Domain: <span className="text-white">{creativeRejectFor.displayDomain}</span>
              </p>
              <p className="text-white text-xs mb-4 truncate">{creativeRejectFor.sponsoredMessage}</p>
              <textarea
                value={creativeRejectReason}
                onChange={(e) => setCreativeRejectReason(e.target.value)}
                placeholder="Reason (required) — visible to advertiser"
                rows={3}
                required
                className="w-full bg-ink-700 border border-ink-600/50 rounded-lg px-4 py-3 text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-500 mb-4"
              />
              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={() => {
                    setCreativeRejectFor(null);
                    setCreativeRejectReason('');
                  }}
                  className="bg-ink-700 hover:bg-ink-600 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectCreativeConfirm}
                  disabled={!creativeRejectReason.trim() || processing === creativeRejectFor.id}
                  className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      
</>
);

}
