'use client';

import { useState } from 'react';
import { Notice } from '@/components/dash';
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
    <section aria-labelledby={`${role}-account-erasure-heading`} className="dash-panel">
      <div className="dash-panel__head">
        <h2 id={`${role}-account-erasure-heading`} className="dash-panel__title">
          Delete account
        </h2>
      </div>
      <p className="text-xs leading-5 text-[var(--copy)]">
        Permanently erase your personal identity. Financial ledger and audit records that must be
        retained for fraud prevention, tax, or legal compliance are de-identified and retained. This
        action cannot be undone.
      </p>

      {error && (
        <div className="mt-3">
          <Notice tone="bad" role="alert">
            {error}
          </Notice>
        </div>
      )}

      {!hasPassword && (
        <div className="mt-4">
          <Notice
            tone="warn"
            title="First, establish a password re-authentication proof"
            actions={
              passwordEmailSent ? undefined : (
                <button
                  type="button"
                  onClick={sendPasswordSetupEmail}
                  disabled={busy || !accountEmail}
                  className="dash-btn dash-btn--glass dash-btn--sm"
                >
                  {busy ? 'Sending…' : 'Email me a password setup link'}
                </button>
              )
            }
          >
            <p className="text-xs leading-5">
              We will email a signed, one-time password setup link. Completing it revokes your
              current sessions; sign in again before continuing.
            </p>
            {passwordEmailSent && (
              <p role="status" className="mt-3 text-xs font-semibold text-[var(--ink)]">
                If that account exists, the password setup email is on its way.
              </p>
            )}
          </Notice>
        </div>
      )}

      {hasPassword && !twoFactorEnabled && (
        <div className="mt-4">
          <Notice tone="warn">
            Enable two-factor authentication above first. Deletion then requests a fresh 2FA step-up
            code at the moment you submit it.
          </Notice>
        </div>
      )}

      {ready && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium">
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-1 block w-full px-4 py-3 text-sm"
            />
          </label>
          <label className="block text-xs font-medium">
            Type DELETE_MY_ACCOUNT
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-1 block w-full px-4 py-3 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-5 font-normal text-[var(--copy)]">
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
            className="dash-btn dash-btn--danger dash-btn--md"
          >
            {busy ? 'Deleting…' : 'Permanently delete my account'}
          </button>
          <p className="text-[11px] leading-4 text-[var(--muted)]">
            On submit, Ateva asks for a fresh authenticator or backup code. The proof is scoped to
            account deletion and expires after five minutes.
          </p>
        </div>
      )}
    </section>
  );
}
