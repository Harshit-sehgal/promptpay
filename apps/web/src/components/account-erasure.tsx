'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { advertiserApi, authApi, developerApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';

interface AccountErasureProps {
  role: 'developer' | 'advertiser';
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  accountEmail?: string;
  /** Test seam; production always performs a hard navigation. */
  redirectAfterDeletion?: (url: string) => void;
}

/** A reachable, step-up-protected self-service identity-erasure flow. */
export function AccountErasure({
  role,
  hasPassword,
  twoFactorEnabled,
  accountEmail,
  redirectAfterDeletion = (url) => window.location.replace(url),
}: AccountErasureProps) {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [forfeitBalance, setForfeitBalance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordEmailSent, setPasswordEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendPasswordSetupEmail = async () => {
    if (!accountEmail) {
      setError('Your account email is unavailable. Refresh this page and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.forgotPassword(accountEmail);
      setPasswordEmailSent(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to send the password setup email'));
    } finally {
      setBusy(false);
    }
  };

  const eraseAccount = async () => {
    if (!hasPassword) {
      setError('Set a password through the secure email link before deleting this account.');
      return;
    }
    if (!twoFactorEnabled) {
      setError('Enable two-factor authentication before deleting this account.');
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      setError('Type DELETE_MY_ACCOUNT exactly to confirm.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        confirmation: 'DELETE_MY_ACCOUNT' as const,
        currentPassword,
        forfeitBalance,
      };
      if (role === 'developer') {
        await developerApi.deleteAccount(payload);
      } else {
        await advertiserApi.deleteAccount(payload);
      }
      try {
        await logout();
      } catch {
        // Erasure revokes every server-side session and credential itself. If
        // the follow-up cookie-clearing request loses the network race, the
        // deletion still succeeded and stale cookies cannot authenticate.
      }
      // A client-side router transition races with ProtectedRoute after
      // logout() clears AuthContext: the old protected tree can overwrite the
      // intended destination with `?returnTo=/...`. A hard navigation tears
      // that tree down immediately and makes the durable login-page
      // confirmation authoritative.
      redirectAfterDeletion('/auth/login?deleted=1');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Account deletion failed'));
    } finally {
      setBusy(false);
    }
  };

  const ready = hasPassword && twoFactorEnabled;

  return (
    <section
      aria-labelledby={`${role}-account-erasure-heading`}
      className="rounded-2xl border border-rose-200/80 bg-white p-7 shadow-sm"
    >
      <h2 id={`${role}-account-erasure-heading`} className="text-base font-bold text-rose-700">
        Delete account
      </h2>
      <p className="mt-2 text-xs leading-5 text-surface-600">
        Permanently erase your personal identity. Financial ledger and audit records that must be
        retained for fraud prevention, tax, or legal compliance are de-identified and retained. This
        action cannot be undone.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
          {error}
        </p>
      )}

      {!hasPassword && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="text-sm font-semibold">
            First, establish a password re-authentication proof
          </p>
          <p className="mt-1 text-xs leading-5">
            We will email a signed, one-time password setup link. Completing it revokes your current
            sessions; sign in again before continuing.
          </p>
          {passwordEmailSent ? (
            <p role="status" className="mt-3 text-xs font-semibold text-emerald-700">
              If that account exists, the password setup email is on its way.
            </p>
          ) : (
            <button
              type="button"
              onClick={sendPasswordSetupEmail}
              disabled={busy || !accountEmail}
              className="mt-3 rounded-lg bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Email me a password setup link'}
            </button>
          )}
        </div>
      )}

      {hasPassword && !twoFactorEnabled && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
          Enable two-factor authentication above first. Deletion then requests a fresh 2FA step-up
          code at the moment you submit it.
        </div>
      )}

      {ready && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-surface-700">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1 block w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/20"
            />
          </label>
          <label className="block text-xs font-medium text-surface-700">
            Type DELETE_MY_ACCOUNT
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-900 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/20"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-5 text-surface-600">
            <input
              type="checkbox"
              checked={forfeitBalance}
              onChange={(event) => setForfeitBalance(event.target.checked)}
              className="mt-0.5"
            />
            I understand that any sub-threshold balance that cannot be paid out will be forfeited.
            Larger or otherwise ineligible balances may still block deletion.
          </label>
          <button
            type="button"
            onClick={eraseAccount}
            disabled={busy || confirmation !== 'DELETE_MY_ACCOUNT' || !currentPassword}
            className="rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Permanently delete my account'}
          </button>
          <p className="text-[11px] leading-4 text-surface-500">
            On submit, Ateva asks for a fresh authenticator or backup code. The proof is scoped to
            account deletion and expires after five minutes.
          </p>
        </div>
      )}
    </section>
  );
}
