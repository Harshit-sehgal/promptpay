'use client';

import { FormEvent, useState } from 'react';

import { adminApi } from '@/lib/api/services';
import { getErrorMessage } from '@/lib/api/errors';
import { useToast } from '@waitlayer/ui';

export default function AdminDevicesPage() {
  const toast = useToast();
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token?: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminApi.issueDeviceRecoveryToken(deviceId, {
        userId,
        reason,
        expiresInMinutes,
      });
      setResult(res.data as { token?: string });
      toast.success('Recovery token issued.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to issue recovery token'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Device recovery</h1>
        <p className="text-surface-500 text-[15px]">
          Issue a one-time device recovery token for a user who lost their per-device event secret.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {result?.token && (
        <div className="bg-emerald-50 border border-emerald-200/70 rounded-lg p-4 mb-6">
          <p className="text-emerald-700 text-xs font-semibold uppercase tracking-wider mb-2">Recovery token</p>
          <code className="block bg-white border border-emerald-200/70 rounded-md px-3 py-2 text-surface-900 text-xs break-all font-mono">
            {result.token}
          </code>
          <p className="text-emerald-700 text-xs mt-2">
            Share this with the user over a verified support channel. It is shown only once.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm space-y-5">
        <div>
          <label className="text-surface-700 text-sm font-medium mb-1.5 block">Device ID</label>
          <input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            required
            placeholder="device uuid"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="text-surface-700 text-sm font-medium mb-1.5 block">User ID</label>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            placeholder="user uuid"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="text-surface-700 text-sm font-medium mb-1.5 block">Reason</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="e.g. lost device, support ticket #123"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="text-surface-700 text-sm font-medium mb-1.5 block">Expires in (minutes)</label>
          <input
            type="number"
            min={5}
            max={1440}
            value={expiresInMinutes}
            onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl text-[14px] transition-colors"
        >
          {busy ? 'Issuing…' : 'Issue recovery token'}
        </button>
      </form>
    </div>
  );
}
