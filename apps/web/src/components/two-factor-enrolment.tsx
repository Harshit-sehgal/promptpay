'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

type Mode = 'idle' | 'setup' | 'disable' | 'regenerate';

interface TwoFactorEnrolmentProps {
  initialEnabled?: boolean;
  hasPassword?: boolean;
  accountEmail?: string;
  onChange?: (enabled: boolean) => void;
  onEnrollmentRequiresRelogin?: () => void;
  /** `dark` matches the admin shell, `light` the account settings pages. */
  tone?: 'light' | 'dark';
}

/**
 * Role-agnostic TOTP enrolment and recovery-code management.
 *
 * Setup deliberately requires a password re-authentication proof. Accounts
 * created with Google can establish that proof through the signed password
 * reset email flow, which also revokes their existing sessions. That keeps
 * this sensitive operation self-service without trusting a stale Google token
 * or weakening the API's re-authentication boundary.
 */
export function TwoFactorEnrolment({
  initialEnabled = false,
  hasPassword = true,
  accountEmail,
  onChange,
  onEnrollmentRequiresRelogin,
  tone = 'light',
}: TwoFactorEnrolmentProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState<Mode>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passwordEmailSent, setPasswordEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => setEnabled(initialEnabled), [initialEnabled]);

  const dark = tone === 'dark';
  const card = dark
    ? 'rounded-xl border border-ink-700 bg-ink-800 p-6'
    : 'rounded-2xl border border-surface-200/80 bg-white p-7 shadow-sm';
  const heading = dark ? 'text-ink-100' : 'text-surface-900';
  const body = dark ? 'text-ink-300' : 'text-surface-600';
  const mutedPanel = dark
    ? 'border-ink-600 bg-ink-900/60 text-ink-200'
    : 'border-surface-200 bg-surface-50 text-surface-700';
  const input = dark
    ? 'rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100'
    : 'rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900';
  const primary = dark
    ? 'rounded-lg bg-red-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40'
    : 'rounded-lg bg-surface-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-surface-800 disabled:opacity-40';

  const resetFlow = () => {
    setMode('idle');
    setSecret('');
    setOtpauthUrl('');
    setQrDataUrl(null);
    setCode('');
    setCurrentPassword('');
    setError(null);
  };

  const sendPasswordSetupEmail = async () => {
    if (!accountEmail) {
      setError('Your account email is unavailable. Refresh this page and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await authApi.forgotPassword(accountEmail);
      setPasswordEmailSent(true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to send the password setup email'));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async () => {
    if (!currentPassword) {
      setError('Enter your current password to confirm it is you.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authApi.setup2fa({ currentPassword });
      setCurrentPassword('');
      setSecret(res.data.secret);
      setOtpauthUrl(res.data.otpauthUrl);
      setMode('setup');
      const { default: QRCode } = await import('qrcode');
      QRCode.toDataURL(res.data.otpauthUrl)
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to initialize 2FA setup'));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.enable2fa(code);
      setEnabled(true);
      setBackupCodes(res.data.backupCodes);
      setBackupCodesSaved(false);
      setMode('idle');
      setCode('');
      setSecret('');
      setOtpauthUrl('');
      setQrDataUrl(null);
      setSuccess('Two-factor authentication enabled. Save your backup codes now.');
      onChange?.(true);
      onEnrollmentRequiresRelogin?.();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to verify code'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.disable2fa();
      setEnabled(false);
      setBackupCodes([]);
      resetFlow();
      setSuccess('Two-factor authentication disabled.');
      onChange?.(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to disable 2FA'));
    } finally {
      setBusy(false);
    }
  };

  const regenerateBackupCodes = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.regenerate2faBackupCodes();
      setBackupCodes(res.data.backupCodes);
      setBackupCodesSaved(false);
      setMode('idle');
      setCode('');
      setSuccess('New backup codes generated. Your previous codes no longer work.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to regenerate backup codes'));
    } finally {
      setBusy(false);
    }
  };

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setBackupCodesSaved(true);
      setSuccess('Backup codes copied. Store them somewhere private.');
    } catch {
      setError('Copy failed. Select the codes and copy them manually.');
    }
  };

  const downloadBackupCodes = () => {
    const blob = new Blob(
      [
        `WaitLayer two-factor backup codes\nGenerated: ${new Date().toISOString()}\n\n${backupCodes.join('\n')}\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'waitlayer-2fa-backup-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupCodesSaved(true);
    setSuccess('Backup codes downloaded. Store the file somewhere private.');
  };

  return (
    <section className={card} aria-labelledby="two-factor-heading">
      <h2 id="two-factor-heading" className={`text-sm font-semibold ${heading}`}>
        Two-factor authentication
      </h2>
      <p className={`mt-1 text-xs leading-5 ${body}`}>
        {enabled
          ? 'Enabled. Your authenticator or a one-time backup code is required at sign-in and for sensitive actions.'
          : 'Add an authenticator app to protect sign-in and sensitive account actions.'}
      </p>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-500">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-3 text-xs text-emerald-500">
          {success}
        </p>
      )}

      {backupCodes.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-400/50 bg-amber-50 p-4 text-amber-950">
          <p className="text-sm font-semibold">Save these one-time backup codes now</p>
          <p className="mt-1 text-xs leading-5">
            Each code works once. This is the only time WaitLayer will display this set.
          </p>
          <ul
            aria-label="Two-factor backup codes"
            className="mt-3 grid grid-cols-1 gap-1 rounded-lg bg-white p-3 font-mono text-sm sm:grid-cols-2"
          >
            {backupCodes.map((backupCode) => (
              <li key={backupCode}>{backupCode}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={copyBackupCodes}
              className="text-xs font-semibold underline"
            >
              Copy codes
            </button>
            <button
              type="button"
              onClick={downloadBackupCodes}
              className="text-xs font-semibold underline"
            >
              Download codes
            </button>
            <button
              type="button"
              disabled={!backupCodesSaved}
              onClick={() => setBackupCodes([])}
              className="text-xs font-semibold underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              I saved them; hide codes
            </button>
          </div>
        </div>
      )}

      {!enabled && mode === 'idle' && !hasPassword && (
        <div className={`mt-4 rounded-xl border p-4 ${mutedPanel}`}>
          <p className="text-sm font-semibold">Set a password before enabling 2FA</p>
          <p className="mt-1 text-xs leading-5">
            We will email a signed, one-time password setup link to your account address. Completing
            it revokes your current sessions; sign in again, then return here to enable 2FA.
          </p>
          {passwordEmailSent ? (
            <p role="status" className="mt-3 text-xs font-semibold text-emerald-500">
              If that account exists, the password setup email is on its way.
            </p>
          ) : (
            <button
              type="button"
              onClick={sendPasswordSetupEmail}
              disabled={busy || !accountEmail}
              className={`${primary} mt-3`}
            >
              {busy ? 'Sending…' : 'Email me a password setup link'}
            </button>
          )}
        </div>
      )}

      {mode === 'idle' && (enabled || hasPassword) && (
        <div className="mt-4 space-y-3">
          {!enabled && (
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void startSetup();
                }
              }}
              placeholder="Current password"
              autoComplete="current-password"
              aria-label="Current password"
              className={`${input} w-full max-w-xs`}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            {!enabled ? (
              <button type="button" onClick={startSetup} disabled={busy} className={primary}>
                {busy ? 'Working…' : 'Enable 2FA'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMode('regenerate');
                    setError(null);
                    setSuccess(null);
                  }}
                  className={primary}
                >
                  Regenerate backup codes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('disable');
                    setError(null);
                    setSuccess(null);
                  }}
                  className={`text-xs font-medium underline ${body}`}
                >
                  Disable 2FA
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'setup' && (
        <div className="mt-4 space-y-3">
          <p className={`text-xs leading-5 ${body}`}>
            Scan the QR code, or enter the key manually, then enter the current 6-digit code.
          </p>
          {qrDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- generated data URI */
            <img src={qrDataUrl} alt="2FA QR code" className="h-40 w-40 rounded bg-white p-2" />
          )}
          {otpauthUrl && !qrDataUrl && (
            <p className={`break-all text-[11px] ${body}`}>{otpauthUrl}</p>
          )}
          {secret && (
            <p className={`text-xs ${body}`}>
              Manual entry key: <code className="font-mono select-all">{secret}</code>
            </p>
          )}
          <TotpInput code={code} setCode={setCode} inputClass={input} onEnter={confirmEnable} />
          <FlowActions
            busy={busy}
            canConfirm={code.length === 6}
            primaryClass={primary}
            bodyClass={body}
            label="Verify and enable"
            onConfirm={confirmEnable}
            onCancel={resetFlow}
          />
        </div>
      )}

      {(mode === 'disable' || mode === 'regenerate') && (
        <div className="mt-4 space-y-3">
          <p className={`text-xs leading-5 ${body}`}>
            Continue to securely confirm with your authenticator or a one-time backup code, then{' '}
            {mode === 'disable' ? 'disable 2FA' : 'replace every existing backup code'}.
          </p>
          <FlowActions
            busy={busy}
            canConfirm
            primaryClass={primary}
            bodyClass={body}
            label={mode === 'disable' ? 'Confirm disable' : 'Generate new codes'}
            onConfirm={mode === 'disable' ? confirmDisable : regenerateBackupCodes}
            onCancel={resetFlow}
          />
        </div>
      )}
    </section>
  );
}

function TotpInput({
  code,
  setCode,
  inputClass,
  onEnter,
}: {
  code: string;
  setCode: (value: string) => void;
  inputClass: string;
  onEnter: () => void | Promise<void>;
}) {
  return (
    <input
      value={code}
      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void onEnter();
        }
      }}
      placeholder="6-digit code"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="Authentication code"
      className={inputClass}
    />
  );
}

function FlowActions({
  busy,
  canConfirm,
  primaryClass,
  bodyClass,
  label,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  canConfirm: boolean;
  primaryClass: string;
  bodyClass: string;
  label: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void onConfirm()}
        disabled={busy || !canConfirm}
        className={primaryClass}
      >
        {busy ? 'Verifying…' : label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className={`text-xs font-medium underline ${bodyClass}`}
      >
        Cancel
      </button>
    </div>
  );
}
