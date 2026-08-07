'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth-context';

interface LogoutButtonProps {
  tone?: 'light' | 'dark';
  /** Test seam; production uses a hard redirect to leave the protected tree. */
  redirectAfterLogout?: (url: string) => void;
}

/** A fail-loud sign-out control shared by every authenticated shell. */
export function LogoutButton({
  tone = 'dark',
  redirectAfterLogout = (url) => window.location.replace(url),
}: LogoutButtonProps) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await logout();
      // ProtectedRoute observes AuthContext becoming empty. Hard navigation
      // prevents its old-tree `returnTo` redirect from racing this deliberate
      // destination, just as in the post-erasure flow.
      redirectAfterLogout('/auth/login');
    } catch (err: unknown) {
      setError(
        getErrorMessage(
          err,
          'Sign out failed; your session is still active. Retry when the service is reachable.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const light = tone === 'light';
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className={`rounded px-1 py-1 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
          light ? 'text-surface-500 hover:text-rose-700' : 'text-ink-300 hover:text-red-300'
        }`}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-52 text-xs leading-4 text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
