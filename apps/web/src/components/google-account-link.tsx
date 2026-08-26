'use client';

import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi } from '@/lib/api/services';

interface GoogleAccountLinkProps {
  initiallyLinked?: boolean;
}

interface GoogleCredentialResponse {
  credential: string;
}

/**
 * Explicitly link the signed-in account to Google after password
 * reauthentication. The ID token is received by GIS and sent directly to the
 * same-origin proxy; it is never stored in React state or browser storage.
 */
export function GoogleAccountLink({ initiallyLinked = false }: GoogleAccountLinkProps) {
  const [linked, setLinked] = useState(initiallyLinked);
  const [currentPassword, setCurrentPassword] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef('');
  const googleInitialized = useRef(false);

  useEffect(() => {
    setLinked(initiallyLinked);
  }, [initiallyLinked]);

  useEffect(() => {
    passwordRef.current = currentPassword;
  }, [currentPassword]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const response = await fetch('/api/auth/config');
        if (!response.ok) return;
        const data = (await response.json()) as { googleClientId?: unknown };
        if (!cancelled && typeof data.googleClientId === 'string' && data.googleClientId) {
          setGoogleClientId(data.googleClientId);
          setGoogleEnabled(true);
        }
      } catch {
        // The account remains usable if Google configuration is unavailable.
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (linked || !googleEnabled || !googleClientId || googleInitialized.current) return;

    let cancelled = false;
    const initializeGoogle = () => {
      if (cancelled || googleInitialized.current || !window.google?.accounts?.id) return;
      const button = buttonRef.current;
      if (!button) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: GoogleCredentialResponse) => {
          const password = passwordRef.current;
          if (!password) {
            setError('Enter your current password before linking Google.');
            return;
          }
          setBusy(true);
          setError(null);
          setSuccess(null);
          try {
            await authApi.linkGoogle(response.credential, password);
            setLinked(true);
            setCurrentPassword('');
            setSuccess('Google is now linked to this account.');
          } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to link Google'));
          } finally {
            setBusy(false);
          }
        },
        auto_select: false,
      });
      window.google.accounts.id.renderButton(button, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 320,
        logo_alignment: 'left',
      });
      googleInitialized.current = true;
    };

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [googleClientId, googleEnabled, linked]);

  return (
    <section className="rounded-3xl border border-surface-200/80 bg-white p-7 shadow-sm">
      <h2 className="text-surface-900 font-bold text-[16px] mb-2">Google sign-in</h2>
      {linked ? (
        <p className="text-emerald-600 text-sm">Google is linked to this account.</p>
      ) : (
        <>
          <p className="text-surface-500 text-sm mb-5">
            Add Google sign-in after confirming your current account password. The Google email must
            match this account.
          </p>
          <div className="max-w-sm space-y-3">
            <div>
              <label
                htmlFor="google-link-current-password"
                className="text-surface-700 text-sm font-medium mb-1.5 block"
              >
                Current password for Google linking
              </label>
              <input
                id="google-link-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={busy}
                className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:ring-2 focus:ring-brand-400/20 focus:ring-offset-2 focus:ring-offset-white focus:border-brand-400"
              />
            </div>
            {googleEnabled ? (
              <div ref={buttonRef} className="min-h-[44px]" aria-label="Link Google account" />
            ) : (
              <p className="text-surface-500 text-xs">Google linking is currently unavailable.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-red-600 text-sm mt-4">
              {error}
            </p>
          )}
          {success && <p className="text-emerald-600 text-sm mt-4">{success}</p>}
        </>
      )}
    </section>
  );
}
