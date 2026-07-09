'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';

import { useToast } from '@waitlayer/ui';

export default function AdvertiserSettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isGoogleOnlyAccount = user?.googleVerified === true && user?.hasPassword === false;

  const handleExport = async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const res = await advertiserApi.exportData();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'waitlayer-advertiser-export.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded.');
    } catch (err: unknown) {
      setExportError(getErrorMessage(err, 'Export failed'));
    } finally {
      setExportBusy(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText !== 'DELETE_MY_ACCOUNT') {
      setDeleteError('Type DELETE_MY_ACCOUNT to confirm.');
      return;
    }
    if (isGoogleOnlyAccount) {
      setDeleteError(
        'Google-only advertiser deletion requires support-assisted verification. Contact support@waitlayer.com from your account email to complete erasure.',
      );
      return;
    }
    if (user?.hasPassword === true && !currentPassword) {
      setDeleteError('Current password is required to delete your account.');
      return;
    }

    // A-044: step-up reauthentication before irreversible erasure. Password
    // accounts must provide their current password. Google-only accounts are
    // blocked above with an explicit support-assisted verification path until
    // Google ID-token reauth is wired in this UI.
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await advertiserApi.deleteAccount({
        confirmation: 'DELETE_MY_ACCOUNT',
        ...(currentPassword ? { currentPassword } : {}),
      });
      toast.success('Your account has been deleted.');
      router.push('/auth/login');
    } catch (err: unknown) {
      setDeleteError(getErrorMessage(err, 'Account deletion failed'));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Settings</h1>
        <p className="text-surface-500 text-[15px]">Manage your advertiser data and account</p>
      </div>

      {exportError && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{exportError}</p>
        </div>
      )}
      {deleteError && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{deleteError}</p>
        </div>
      )}

      <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm space-y-8">
        <div>
          <h2 className="text-surface-900 font-bold text-[16px] mb-2">Export my data</h2>
          <p className="text-surface-500 text-xs mb-4">
            Download a copy of your profile, campaigns, creatives, billing ledger, and consent records.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportBusy}
            className="bg-surface-50 border border-surface-200 text-surface-600 hover:bg-surface-100/50 hover:text-surface-900 font-medium px-6 py-2.5 rounded-xl text-[14px] transition-colors"
          >
            {exportBusy ? 'Preparing…' : 'Export my data'}
          </button>
        </div>

        <div className="border-t border-surface-100 pt-6">
          <h2 className="text-rose-600 font-bold text-[16px] mb-2">Delete account</h2>
          <p className="text-surface-500 text-xs mb-4">
            This permanently erases your personal identity. Ledger, payout, and audit records are
            retained for compliance. This action cannot be undone.
          </p>
          {isGoogleOnlyAccount ? (
            <div className="bg-amber-50 border border-amber-200/70 rounded-xl p-4 mb-3">
              <p className="text-amber-800 text-sm font-medium">Google-only deletion needs support verification</p>
              <p className="text-amber-700 text-xs mt-1 leading-relaxed">
                This account does not have a password step-up. Email{' '}
                <a
                  href="mailto:support@waitlayer.com?subject=Advertiser%20account%20erasure"
                  className="font-semibold underline underline-offset-2"
                >
                  support@waitlayer.com
                </a>{' '}
                from your account address to complete advertiser erasure.
              </p>
            </div>
          ) : (
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password (required for deletion)"
              autoComplete="current-password"
              className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 mb-3 focus:outline-none focus:border-rose-400"
            />
          )}
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE_MY_ACCOUNT"
            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 mb-3 focus:outline-none focus:border-rose-400"
          />
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteBusy || confirmText !== 'DELETE_MY_ACCOUNT' || isGoogleOnlyAccount}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl text-[14px] transition-colors"
          >
            {deleteBusy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
