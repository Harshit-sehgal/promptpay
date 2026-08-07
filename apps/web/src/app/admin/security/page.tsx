'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
import { ADMIN_MFA_RELOGIN_REQUIRED_KEY } from '@/lib/admin-mfa';
import { getErrorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth-context';

/**
 * Admin account security (A-099).
 *
 * The only 2FA enrolment UI used to live under `/developer/settings`, which is
 * role-gated to developers — so an administrator was shown "Access denied" and
 * had no way to enrol TOTP. In production `AdminMfaStepUpGuard` rejects every
 * admin write without recent 2FA, so the first administrator could log in, read
 * everything, and change nothing: no campaign approval, no money switch, no
 * payout. This page closes that loop.
 */
export default function AdminSecurityPage() {
  const router = useRouter();
  const { user, logout, refreshUser } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [needsRelogin, setNeedsRelogin] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => setEnabled(user?.twoFactorEnabled === true), [user?.twoFactorEnabled]);
  useEffect(() => {
    setNeedsRelogin(localStorage.getItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY) === '1');
  }, []);

  const handleSecurityChange = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    if (!nextEnabled) {
      localStorage.removeItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY);
      setNeedsRelogin(false);
    }
    void refreshUser().catch(() => {
      // The enrollment request itself succeeded. A later /auth/me refresh can
      // recover on navigation and must not turn that success into a false error.
    });
  };

  const requireFreshLogin = () => {
    localStorage.setItem(ADMIN_MFA_RELOGIN_REQUIRED_KEY, '1');
    setNeedsRelogin(true);
  };

  const signOutForFreshLogin = async () => {
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      await logout();
      router.replace('/auth/login?returnTo=%2Fadmin%2Fsecurity');
    } catch (err: unknown) {
      setLogoutError(getErrorMessage(err, 'Sign-out failed; your session is still active'));
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-400">Admin</p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink-100">Account security</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-400">
        Two-factor authentication is <strong className="text-ink-200">required</strong> for
        administrator actions in production. Until it is enabled, every write — approving a
        campaign, changing a platform switch, verifying or processing a payout — is rejected with
        &ldquo;Recent two-factor authentication is required&rdquo;.
      </p>

      {(!enabled || needsRelogin) && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          {!enabled ? (
            <>
              <p className="font-semibold">This account cannot perform admin actions yet.</p>
              <p className="mt-1 opacity-90">
                Enrol an authenticator below. Re-authentication is also required periodically
                (default 10 minutes) before sensitive actions.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">
                2FA is enabled, but this session is not MFA-authenticated.
              </p>
              <p className="mt-1 opacity-90">
                Enabling 2FA does not rewrite the authentication time in your existing token. Sign
                out and sign in with a current code before attempting any administrator write.
              </p>
              {logoutError && <p className="mt-2 text-red-300">{logoutError}</p>}
              <button
                type="button"
                onClick={signOutForFreshLogin}
                disabled={logoutBusy}
                className="mt-3 rounded-lg bg-amber-200 px-3.5 py-2 text-xs font-semibold text-amber-950 disabled:opacity-50"
              >
                {logoutBusy ? 'Signing out…' : 'Sign out and verify 2FA'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="mt-6">
        <TwoFactorEnrolment
          initialEnabled={enabled}
          hasPassword={user?.hasPassword === true}
          accountEmail={user?.email}
          onChange={handleSecurityChange}
          onEnrollmentRequiresRelogin={requireFreshLogin}
          tone="dark"
        />
      </div>
    </div>
  );
}
