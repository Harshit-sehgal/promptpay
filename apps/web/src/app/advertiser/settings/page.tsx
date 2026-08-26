'use client';

import { useEffect, useState } from 'react';
import { AccountErasure } from '@/components/account-erasure';
import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
import { stringifyApiData } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';

import { useToast } from '@ateva/ui';

interface SelfServiceExportPayload {
  exportMeta?: {
    truncated?: boolean;
  };
}

export default function AdvertiserSettingsPage() {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user?.twoFactorEnabled === true);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => setTwoFactorEnabled(user?.twoFactorEnabled === true), [user?.twoFactorEnabled]);

  const handleExport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const res = await advertiserApi.exportData();
      const exportData = res.data as SelfServiceExportPayload;
      const blob = new Blob([stringifyApiData(exportData, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ateva-advertiser-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
      if (exportData.exportMeta?.truncated) {
        toast.info('Export downloaded. Some activity sections were capped; see exportMeta.');
      } else {
        toast.success('Export downloaded.');
      }
    } catch (err: unknown) {
      setExportError(getErrorMessage(err, 'Export failed'));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-surface-900">Settings</h1>
        <p className="text-sm text-surface-500">Manage your advertiser data and account security</p>
      </div>

      {exportError && (
        <div className="mb-6 rounded-xl border border-red-200/60 bg-red-50 p-4">
          <p className="text-sm text-red-600">{exportError}</p>
        </div>
      )}

      <div className="space-y-6">
        <section className="rounded-3xl border border-surface-200/80 bg-white p-7 shadow-sm">
          <h2 className="mb-2 text-[16px] font-bold text-surface-900">Export my data</h2>
          <p className="mb-4 text-xs text-surface-500">
            Download a recent self-service JSON snapshot of your profile, campaigns, creatives,
            billing ledger, and consent records. High-volume sections are capped and marked in
            <code className="mx-1 font-mono">exportMeta</code>; contact support for a
            compliance-grade full export.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy}
            className="rounded-xl border border-surface-200 bg-surface-50 px-6 py-2.5 text-sm font-medium text-surface-600 transition-colors hover:bg-surface-100/50 hover:text-surface-900"
          >
            {exportBusy ? 'Preparing…' : 'Export my data'}
          </button>
        </section>

        <TwoFactorEnrolment
          initialEnabled={twoFactorEnabled}
          hasPassword={user?.hasPassword === true}
          accountEmail={user?.email}
          onChange={(nextEnabled) => {
            setTwoFactorEnabled(nextEnabled);
            void refreshUser().catch(() => {
              // The mutation succeeded; the profile can recover on navigation.
            });
          }}
        />

        <AccountErasure
          role="advertiser"
          hasPassword={user?.hasPassword === true}
          twoFactorEnabled={twoFactorEnabled}
          accountEmail={user?.email}
        />
      </div>
    </div>
  );
}
