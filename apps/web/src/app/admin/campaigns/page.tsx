'use client';

import { useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { adminApi } from '@/lib/api/services';
import { formatCurrency, formatRelativeTime } from '@/lib/format';

interface PendingCampaign {
  id: string;
  name: string;
  advertiserEmail: string;
  category: string;
  bidType: string;
  bidAmountMinor: number;
  budgetTotalMinor: number;
  currency: string;
  createdAt: string;
  landingUrl: string;
}

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<PendingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectModalFor, setRejectModalFor] = useState<PendingCampaign | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchCampaigns = () => {
    setLoading(true);
    adminApi.getPendingCampaigns()
      .then((res: any) => setCampaigns(res.data.campaigns || res.data || []))
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load campaigns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await adminApi.approveCampaign(id);
      fetchCampaigns();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Approve failed');
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
    } catch (err: any) {
      setError(err.response?.data?.message || 'Reject failed');
    } finally {
      setProcessing(null);
    }
  };

  return (
<>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Campaign approvals</h1>
          <p className="text-ink-300 text-sm">Review and approve submitted campaigns</p>
        </div>

        {loading && <LoadingSpinner />}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
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
                    <StatusBadge status="submitted" />
                    <h3 className="text-white font-medium">{c.name}</h3>
                    <span className="text-ink-500 text-xs capitalize">{c.category.replace('_', ' ')}</span>
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
                      {processing === c.id ? 'Processing...' : 'Approve'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-ink-500 text-xs">Advertiser</p>
                    <p className="text-white text-xs">{c.advertiserEmail}</p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Bid</p>
                    <p className="text-white font-mono">
                      {formatCurrency(c.bidAmountMinor)}/{c.bidType === 'cpm' ? '1k imp' : 'click'}
                    </p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Budget</p>
                    <p className="text-white font-mono">{formatCurrency(c.budgetTotalMinor)}</p>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Landing URL</p>
                    <a
                      href={c.landingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-500 hover:text-brand-400 text-xs truncate block"
                    >
                      {c.landingUrl}
                    </a>
                  </div>
                  <div>
                    <p className="text-ink-500 text-xs">Submitted</p>
                    <p className="text-ink-300 text-xs">{formatRelativeTime(c.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reject modal */}
        {rejectModalFor && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
            <div className="bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-white font-semibold mb-2">Reject campaign</h3>
              <p className="text-ink-400 text-sm mb-4">
                <span className="text-white">{rejectModalFor.name}</span>
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
      
</>
);

}
