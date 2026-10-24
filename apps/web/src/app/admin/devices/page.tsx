'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LoadingSpinner, StatusBadge } from '@/components';
import { Notice, PageHeader, Panel, PanelHeader } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';
import { formatRelativeTime } from '@/lib/format';

import { useToast } from '@ateva/ui';

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
  const [result, setResult] = useState<{ recoverySupportToken?: string; token?: string } | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [devicePage, setDevicePage] = useState(1);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const DEVICE_PAGE_SIZE = 25;

  const fetchDevices = useCallback(async () => {
    setDeviceLoading(true);
    setError(null);
    try {
      const res = await adminApi.getDevices({
        limit: DEVICE_PAGE_SIZE,
        page: devicePage,
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
  }, [submittedSearch, devicePage]);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(search.trim());
    setDevicePage(1);
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
    <>
      <PageHeader
        eyebrow="Admin"
        title="Device recovery"
        lede="Find a developer device and issue a one-time recovery token for a lost per-device event secret."
      />

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {recoveryToken && (
        <Notice tone="ok" title="Recovery token">
          <code className="block rounded-xl border border-[var(--hair)] bg-[var(--glass-strong)] px-3 py-2 text-xs break-all text-[var(--ink)]">
            {recoveryToken}
          </code>
          <p className="mt-2 text-xs">
            Share this with the user over a verified support channel. It is shown only once.
          </p>
        </Notice>
      )}

      <div className="dash-grid dash-grid--wide-left">
        <Panel label="Registered devices">
          <PanelHeader
            title="Registered devices"
            action={
              <span className="text-xs whitespace-nowrap text-[var(--muted)]">
                {deviceTotal} total
              </span>
            }
          />
          <p className="mb-5 text-xs text-[var(--muted)]">
            Search by user email, user id, device id, fingerprint, platform, or tool type.
          </p>

          <form onSubmit={handleSearch} className="mb-5 flex flex-col gap-3 sm:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices..."
              className="flex-1 px-4 py-3"
            />
            <button type="submit" className="dash-btn dash-btn--primary dash-btn--md">
              Search
            </button>
          </form>

          {deviceLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : devices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--hair)] p-8 text-center">
              <p className="text-sm text-[var(--muted)]">No devices found.</p>
            </div>
          ) : (
            <div className="dash-rows -mx-[22px]">
              {devices.map((device) => (
                <div key={device.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={device.toolType} kind="metadata" />
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {device.user.email ?? device.user.name ?? device.userId}
                        </p>
                        <span className="text-xs text-[var(--muted)]">{device.user.status}</span>
                      </div>
                      <p className="dash-mono mt-2 text-xs break-all text-[var(--muted)]">
                        Device: {device.id}
                      </p>
                      <p className="dash-mono mt-1 text-xs break-all text-[var(--muted)]">
                        User: {device.userId}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--copy)]">
                        <span>Platform: {device.platform || 'unknown'}</span>
                        <span>Version: {device.extensionVersion || 'unknown'}</span>
                        <span>Last seen: {formatRelativeTime(device.lastSeenAt)}</span>
                        <span>{device.hasEventSecret ? 'Recoverable' : 'Legacy re-register'}</span>
                      </div>
                      {device.latestRecoveryToken && (
                        <p className="mt-2 text-xs text-[var(--copy)]">
                          Latest token{' '}
                          {device.latestRecoveryToken.usedAt
                            ? 'used'
                            : device.latestRecoveryToken.revokedAt
                              ? 'revoked'
                              : 'issued'}{' '}
                          {formatRelativeTime(device.latestRecoveryToken.createdAt)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => selectDevice(device)}
                      disabled={!device.hasEventSecret || device.user.role !== 'developer'}
                      className="dash-btn dash-btn--glass dash-btn--sm shrink-0"
                    >
                      Use
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!deviceLoading && devices.length > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">
                Page {devicePage} of {Math.max(1, Math.ceil(deviceTotal / DEVICE_PAGE_SIZE))}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDevicePage((p) => Math.max(1, p - 1))}
                  disabled={devicePage <= 1}
                  className="dash-btn dash-btn--glass dash-btn--sm"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDevicePage((p) =>
                      Math.min(Math.max(1, Math.ceil(deviceTotal / DEVICE_PAGE_SIZE)), p + 1),
                    )
                  }
                  disabled={devicePage >= Math.max(1, Math.ceil(deviceTotal / DEVICE_PAGE_SIZE))}
                  className="dash-btn dash-btn--glass dash-btn--sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </Panel>

        <Panel label="Issue recovery token" className="h-fit">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h2 className="dash-panel__title mb-1">Issue recovery token</h2>
              <p className="text-xs text-[var(--muted)]">
                Select a device from the lookup or enter IDs manually.
              </p>
            </div>
            <div>
              <label htmlFor="recovery-device-id" className="mb-1.5 block text-sm font-medium">
                Device ID
              </label>
              <input
                id="recovery-device-id"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                required
                placeholder="device uuid"
                className="w-full px-4 py-3"
              />
            </div>
            <div>
              <label htmlFor="recovery-user-id" className="mb-1.5 block text-sm font-medium">
                User ID
              </label>
              <input
                id="recovery-user-id"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                placeholder="user uuid"
                className="w-full px-4 py-3"
              />
            </div>
            <div>
              <label htmlFor="recovery-reason" className="mb-1.5 block text-sm font-medium">
                Reason
              </label>
              <input
                id="recovery-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                placeholder="e.g. lost device, support ticket #123"
                className="w-full px-4 py-3"
              />
            </div>
            <div>
              <label htmlFor="recovery-expires" className="mb-1.5 block text-sm font-medium">
                Expires in (minutes)
              </label>
              <input
                id="recovery-expires"
                type="number"
                min={5}
                max={60}
                value={expiresInMinutes}
                onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
                className="w-full px-4 py-3"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="dash-btn dash-btn--primary dash-btn--md"
            >
              {busy ? 'Issuing...' : 'Issue recovery token'}
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
