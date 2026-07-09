'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

import { useToast } from '@waitlayer/ui';

interface AdminDevice {
  id: string;
  userId: string;
  fingerprintHash: string;
  hasEventSecret: boolean;
  toolType: string;
  extensionVersion?: string | null;
  platform?: string | null;
  createdAt: string;
  lastSeenAt: string;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    status: string;
  };
  latestRecoveryToken?: {
    id: string;
    reason?: string | null;
    expiresAt: string;
    usedAt?: string | null;
    revokedAt?: string | null;
    createdAt: string;
  } | null;
}

interface AdminDevicesResponse {
  devices: AdminDevice[];
  total: number;
}

export default function AdminDevicesPage() {
  const toast = useToast();
  const [deviceId, setDeviceId] = useState('');
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ recoverySupportToken?: string; token?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [deviceLoading, setDeviceLoading] = useState(true);

  const fetchDevices = useCallback(async () => {
    setDeviceLoading(true);
    setError(null);
    try {
      const res = await adminApi.getDevices({
        limit: 25,
        ...(submittedSearch ? { search: submittedSearch } : {}),
      });
      const data = res.data as AdminDevicesResponse;
      setDevices(data.devices || []);
      setDeviceTotal(data.total || 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load devices'));
    } finally {
      setDeviceLoading(false);
    }
  }, [submittedSearch]);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(search.trim());
  };

  const selectDevice = (device: AdminDevice) => {
    setDeviceId(device.id);
    setUserId(device.userId);
    if (!reason.trim()) {
      setReason(`Support recovery for ${device.user.email ?? device.userId}`);
    }
    setResult(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminApi.issueDeviceRecoveryToken(deviceId, {
        userId,
        reason: reason.trim(),
        expiresInMinutes,
      });
      setResult(res.data as { recoverySupportToken?: string; token?: string });
      toast.success('Recovery token issued.');
      void fetchDevices();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to issue recovery token'));
    } finally {
      setBusy(false);
    }
  };

  const recoveryToken = result?.recoverySupportToken ?? result?.token;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Device recovery</h1>
        <p className="text-surface-500 text-[15px]">
          Find a developer device and issue a one-time recovery token for a lost per-device event secret.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {recoveryToken && (
        <div className="bg-emerald-50 border border-emerald-200/70 rounded-lg p-4 mb-6">
          <p className="text-emerald-700 text-xs font-semibold uppercase tracking-wider mb-2">Recovery token</p>
          <code className="block bg-white border border-emerald-200/70 rounded-md px-3 py-2 text-surface-900 text-xs break-all font-mono">
            {recoveryToken}
          </code>
          <p className="text-emerald-700 text-xs mt-2">
            Share this with the user over a verified support channel. It is shown only once.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
        <section className="bg-white border border-surface-200/80 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-surface-900 font-semibold text-[16px]">Registered devices</h2>
              <p className="text-surface-500 text-xs mt-1">
                Search by user email, user id, device id, fingerprint, platform, or tool type.
              </p>
            </div>
            <span className="text-surface-500 text-xs whitespace-nowrap">{deviceTotal} total</span>
          </div>

          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 mb-5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices..."
              className="flex-1 bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
            />
            <button
              type="submit"
              className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-5 py-2.5 rounded-xl text-[14px] transition-colors"
            >
              Search
            </button>
          </form>

          {deviceLoading ? (
            <div className="py-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : devices.length === 0 ? (
            <div className="border border-dashed border-surface-200 rounded-xl p-8 text-center">
              <p className="text-surface-500 text-sm">No devices found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => (
                <div key={device.id} className="border border-surface-200/80 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={device.toolType} />
                        <p className="text-surface-900 font-medium text-sm truncate">
                          {device.user.email ?? device.user.name ?? device.userId}
                        </p>
                        <span className="text-surface-400 text-xs">{device.user.status}</span>
                      </div>
                      <p className="text-surface-500 text-xs mt-2 font-mono break-all">Device: {device.id}</p>
                      <p className="text-surface-500 text-xs mt-1 font-mono break-all">User: {device.userId}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-surface-500">
                        <span>Platform: {device.platform || 'unknown'}</span>
                        <span>Version: {device.extensionVersion || 'unknown'}</span>
                        <span>Last seen: {formatRelativeTime(device.lastSeenAt)}</span>
                        <span>{device.hasEventSecret ? 'Recoverable' : 'Legacy re-register'}</span>
                      </div>
                      {device.latestRecoveryToken && (
                        <p className="text-amber-700 text-xs mt-2">
                          Latest token {device.latestRecoveryToken.usedAt ? 'used' : device.latestRecoveryToken.revokedAt ? 'revoked' : 'issued'} {formatRelativeTime(device.latestRecoveryToken.createdAt)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => selectDevice(device)}
                      disabled={!device.hasEventSecret || device.user.role !== 'developer'}
                      className="shrink-0 text-brand-600 hover:text-brand-500 disabled:text-surface-300 text-xs font-medium"
                    >
                      Use
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm space-y-5 h-fit">
          <div>
            <h2 className="text-surface-900 font-semibold text-[16px] mb-1">Issue recovery token</h2>
            <p className="text-surface-500 text-xs">Select a device from the lookup or enter IDs manually.</p>
          </div>
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
              max={60}
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
            {busy ? 'Issuing...' : 'Issue recovery token'}
          </button>
        </form>
      </div>
    </div>
  );
}
