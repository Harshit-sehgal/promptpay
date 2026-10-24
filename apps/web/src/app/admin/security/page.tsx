'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Notice, PageHeader } from '@/components/dash';
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
    <>
      <PageHeader
        eyebrow="Admin"
        title="Account security"
        lede={
          <>
            Two-factor authentication is <strong className="text-[var(--ink)]">required</strong> for
            administrator actions in production. Until it is enabled, every write — approving a
            campaign, changing a platform switch, verifying or processing a payout — is rejected
            with &ldquo;Recent two-factor authentication is required&rdquo;.
          </>
        }
      />

      {(!enabled || needsRelogin) && (
        <Notice
          tone="warn"
          role="status"
          title={
            !enabled
              ? 'This account cannot perform admin actions yet.'
              : '2FA is enabled, but this session is not MFA-authenticated.'
          }
        >
          {!enabled ? (
            <p>
              Enrol an authenticator below. Re-authentication is also required periodically (default
              10 minutes) before sensitive actions.
            </p>
          ) : (
            <>
              <p>
                Enabling 2FA does not rewrite the authentication time in your existing token. Sign
                out and sign in with a current code before attempting any administrator write.
              </p>
              {logoutError && <p className="mt-2 text-[var(--ink)]">{logoutError}</p>}
              <button
                type="button"
                onClick={signOutForFreshLogin}
                disabled={logoutBusy}
                className="dash-btn dash-btn--primary dash-btn--sm mt-3"
              >
                {logoutBusy ? 'Signing out…' : 'Sign out and verify 2FA'}
              </button>
            </>
          )}
        </Notice>
      )}

      <TwoFactorEnrolment
        initialEnabled={enabled}
        hasPassword={user?.hasPassword === true}
        accountEmail={user?.email}
        onChange={handleSecurityChange}
        onEnrollmentRequiresRelogin={requireFreshLogin}
        tone="dark"
      />
    </>
  );
}
