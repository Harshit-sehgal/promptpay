'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

/**
 * Self-service TOTP enrolment (A-099).
 *
 * WHY THIS IS A SHARED COMPONENT
 * ------------------------------
 * The only 2FA enrolment UI used to live inside `/developer/settings`, which is
 * wrapped in `<ProtectedRoute allowedRoles={['developer']}>`. An `admin` /
 * `super_admin` who navigated there got "Access denied — Your account role
 * (super_admin) does not have access to this page."
 *
 * That was a hard launch blocker, not a UX gap: in production
 * `AdminMfaStepUpGuard` rejects **every** admin POST/PUT/PATCH/DELETE unless
 * 2FA is enabled AND recent. So the first administrator — created by
 * `scripts/bootstrap-admin.mjs`, which is itself the only way an admin can
 * exist (A-088) — could log in, read every admin page, and never approve a
 * campaign, flip a money switch, verify a payout account, or process a payout.
 * The deployment was inert for a second, independent reason.
 *
 * The API endpoints (`/auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/disable`)
 * are role-agnostic and already on the BFF proxy allowlist; only the UI was
 * gated.
 *
 * KNOWN DUPLICATION (follow-up, not a blocker): `/developer/settings` still has
 * its own inline copy of this flow — it was patched in place for A-100 rather
 * than refactored, because rewriting a 900-line settings page while closing a
 * launch blocker is the bigger risk. **If you change the 2FA flow, change
 * BOTH**, and prefer collapsing the developer page onto this component while
 * you are in there.
 */
export function TwoFactorEnrolment({
  initialEnabled = false,
  onChange,
  tone = 'light',
}: {
  initialEnabled?: boolean;
  onChange?: (enabled: boolean) => void;
  /** `dark` matches the admin shell, `light` the developer settings page. */
  tone?: 'light' | 'dark';
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [showSetup, setShowSetup] = useState(false);
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // A-100: `POST /auth/2fa/setup` requires a re-authentication proof
  // (`auth-totp.trait.ts` — "Reauthentication is required before setting up
  // 2FA"). Calling it without one returns 401, which is exactly what the UI
  // used to do, so enrolment was impossible for every user.
  const [currentPassword, setCurrentPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dark = tone === 'dark';
  const card = dark
    ? 'rounded-xl border border-ink-700 bg-ink-800 p-6'
    : 'rounded-xl border border-surface-200 bg-white p-6';
  const heading = dark ? 'text-ink-100' : 'text-surface-900';
  const body = dark ? 'text-ink-300' : 'text-surface-600';
  const input = dark
    ? 'rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100'
    : 'rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900';
  const primary = dark
    ? 'rounded-lg bg-red-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40'
    : 'rounded-lg bg-surface-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-surface-800 disabled:opacity-40';

  const startSetup = async () => {
    if (!currentPassword) {
      setError('Enter your current password to confirm it is you.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Send the re-auth proof (A-100). Without it the API returns 401.
      const res = await authApi.setup2fa({ currentPassword });
      setNeedsPassword(false);
      setCurrentPassword('');
      setSecret(res.data.secret);
      setOtpauthUrl(res.data.otpauthUrl);
      // Lazy-load the QR renderer so `qrcode` stays out of the initial bundle.
      const { default: QRCode } = await import('qrcode');
      QRCode.toDataURL(res.data.otpauthUrl)
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
      setShowSetup(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to initialize 2FA setup'));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.enable2fa(code);
      setEnabled(true);
      setShowSetup(false);
      setCode('');
      setSecret('');
      setSuccess('Two-factor authentication enabled.');
      onChange?.(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to verify code'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.disable2fa(code);
      setEnabled(false);
      setShowSetup(false);
      setCode('');
      setSuccess('Two-factor authentication disabled.');
      onChange?.(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to disable 2FA'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <h2 className={`text-sm font-semibold ${heading}`}>Two-factor authentication</h2>
      <p className={`mt-1 text-xs leading-5 ${body}`}>
        {enabled
          ? 'Enabled. Your authenticator app is required for sensitive actions.'
          : 'Scan the QR code with an authenticator app, then enter the 6-digit code to enable.'}
      </p>

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      {success && <p className="mt-3 text-xs text-emerald-500">{success}</p>}

      {!showSetup && (
        <div className="mt-4 space-y-3">
          {needsPassword && (
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              aria-label="Current password"
              className={`${input} w-full max-w-xs`}
            />
          )}
          <div className="flex items-center gap-3">
            <button type="button" onClick={startSetup} disabled={busy} className={primary}>
              {busy ? 'Working…' : enabled ? 'Reconfigure' : 'Enable 2FA'}
            </button>
            {enabled && (
              <button
                type="button"
                onClick={() => {
                  setShowSetup(true);
                  setSecret('');
                  setQrDataUrl(null);
                }}
                className={`text-xs font-medium underline ${body}`}
              >
                Disable
              </button>
            )}
          </div>
        </div>
      )}

      {showSetup && (
        <div className="mt-4 space-y-3">
          {qrDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- data: URI, no loader */
            <img src={qrDataUrl} alt="2FA QR code" className="h-40 w-40 rounded bg-white p-2" />
          )}
          {otpauthUrl && !qrDataUrl && (
            <p className={`break-all text-[11px] ${body}`}>{otpauthUrl}</p>
          )}
          {secret && (
            <p className={`text-xs ${body}`}>
              Manual entry key: <code className="font-mono">{secret}</code>
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Authentication code"
            className={input}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={enabled && !secret ? confirmDisable : confirmEnable}
              disabled={busy || code.length !== 6}
              className={primary}
            >
              {busy ? 'Verifying…' : enabled && !secret ? 'Confirm disable' : 'Verify and enable'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSetup(false);
                setCode('');
                setError(null);
              }}
              className={`text-xs font-medium underline ${body}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
