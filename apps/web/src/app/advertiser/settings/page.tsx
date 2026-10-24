'use client';

import { useEffect, useState } from 'react';
import { AccountErasure } from '@/components/account-erasure';
import { Notice, PageHeader, Panel, PanelHeader } from '@/components/dash';
import { GoogleAccountLink } from '@/components/google-account-link';
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
    <>
      <PageHeader title="Settings" />

      {exportError && (
        <Notice tone="bad" role="alert">
          {exportError}
        </Notice>
      )}

      <div className="grid max-w-2xl gap-5">
        <Panel label="Export my data">
          <PanelHeader title="Export my data" />
          <p className="mb-4 text-xs text-[var(--copy)]">
            Download a recent self-service JSON snapshot of your profile, campaigns, creatives,
            billing ledger, and consent records. High-volume sections are capped and marked in
            <code className="mx-1">exportMeta</code>; contact support for a compliance-grade full
            export.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy}
            className="dash-btn dash-btn--secondary dash-btn--md"
          >
            {exportBusy ? 'Preparing…' : 'Export my data'}
          </button>
        </Panel>

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

        <GoogleAccountLink initiallyLinked={user?.googleVerified === true} />

        <AccountErasure
          role="advertiser"
          hasPassword={user?.hasPassword === true}
          twoFactorEnabled={twoFactorEnabled}
          accountEmail={user?.email}
        />
      </div>
    </>
  );
}
