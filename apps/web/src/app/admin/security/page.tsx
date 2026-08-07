'use client';

import { useState } from 'react';
import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
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
  // `useAuth` already carries `twoFactorEnabled` from `/auth/me`, so there is
  // no second fetch to keep in sync here.
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(user?.twoFactorEnabled === true);

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

      {!enabled && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <p className="font-semibold">This account cannot perform admin actions yet.</p>
          <p className="mt-1 opacity-90">
            Enrol an authenticator below. Re-authentication is also required periodically (default
            10 minutes) before sensitive actions.
          </p>
        </div>
      )}

      <div className="mt-6">
        <TwoFactorEnrolment initialEnabled={enabled} onChange={setEnabled} tone="dark" />
      </div>
    </div>
  );
}
