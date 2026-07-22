'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api/client';
import { useAuth } from '@/lib/auth-context';
import { readStoredCookieConsent, writeStoredCookieConsent } from '@/lib/consent-preferences';

import { useToast } from '@waitlayer/ui';

const VISITOR_ID_KEY = 'wl_visitor_id';
const OPEN_EVENT = 'wl:open-cookie-settings';

type Choice = 'accepted' | 'declined';

/**
 * Returns a stable, per-browser pseudonymous visitor id used to anchor
 * logged-out (anonymous) server-side consent (A-009). The raw id never leaves
 * the browser beyond this hashed value; the API only stores its sha256.
 */
function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}

export default function CookieConsent() {
  const { isAuthenticated } = useAuth();
  const [visible, setVisible] = useState(false);
  const [marketingVersion, setMarketingVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const { success } = useToast();

  const loadRequiredVersion = useCallback(async () => {
    setVersionLoading(true);
    setSyncError(null);
    // Resolve the server-required marketing_cookies version so the recorded
    // consent matches the current policy version (rather than a hard-coded
    // constant that drifts from the backend).
    try {
      const res = await api.get<Record<string, string>>('/consent/required-versions');
      const version = res.data?.marketing_cookies;
      if (!version) throw new Error('Missing marketing cookie consent version');
      setMarketingVersion(version);
      const stored = readStoredCookieConsent();
      setVisible(stored?.version !== version);
    } catch {
      setMarketingVersion(null);
      setSyncError('Cookie preferences are temporarily unavailable.');
      setVisible(true);
    } finally {
      setVersionLoading(false);
    }
  }, []);

  useEffect(() => {
    const reopen = () => setVisible(true);
    window.addEventListener(OPEN_EVENT, reopen);

    void loadRequiredVersion();

    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, [loadRequiredVersion]);

  const persist = (choice: Choice) => {
    if (!marketingVersion) return;
    writeStoredCookieConsent(choice, marketingVersion);
    setVisible(false);
  };

  const recordConsent = async (granted: boolean) => {
    if (!marketingVersion) {
      throw new Error('Missing required marketing cookie consent version');
    }
    await api.post('/consent', {
      purpose: 'marketing_cookies',
      version: marketingVersion,
      granted,
      metadata: { method: 'cookie_banner' },
    });
  };

  // Privacy-minimized server-side record for LOGGED-OUT visitors (A-009). The
  // raw visitor id stays in localStorage; the API stores only its sha256 hash.
  // Non-fatal: a failure must never block the user from dismissing the banner,
  // so the local persistence below remains the source of truth for the UI.
  const recordAnonymousConsent = async (granted: boolean) => {
    if (!marketingVersion) return;
    try {
      await api.post('/consent/anonymous', {
        visitorId: getVisitorId(),
        purpose: 'marketing_cookies',
        version: marketingVersion,
        granted,
      });
    } catch {
      // Keep the existing browser-local preference even if the server write fails.
    }
  };

  const choose = async (choice: Choice) => {
    setSyncError(null);
    if (!marketingVersion) {
      setSyncError('Cookie preferences are temporarily unavailable. Please try again.');
      return;
    }
    if (isAuthenticated) {
      try {
        await recordConsent(choice === 'accepted');
      } catch {
        setSyncError('Could not save cookie preferences to your account. Please try again.');
        return;
      }
    } else {
      await recordAnonymousConsent(choice === 'accepted');
    }
    persist(choice);
    success('Cookie preferences saved');
  };

  const accept = () => void choose('accepted');

  const decline = () => void choose('declined');

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl bg-white border border-surface-200 rounded-2xl shadow-lg shadow-surface-300/30 p-5 flex flex-col sm:flex-row sm:items-center gap-4 motion-reduce:shadow-none">
        <p className="text-surface-700 text-[13px] leading-relaxed flex-1">
          We use essential cookies to keep you signed in and optional analytics cookies to improve
          WaitLayer. See our{' '}
          <Link
            href="/privacy"
            className="text-brand-700 hover:text-brand-800 font-medium underline underline-offset-2 focus-visible:rounded-sm"
          >
            Privacy Policy
          </Link>{' '}
          for details.
        </p>
        {versionLoading && <p className="text-surface-500 text-[12px]">Loading preferences...</p>}
        {syncError && !versionLoading && (
          <div className="flex items-center gap-2" role="alert">
            <p className="text-red-600 text-[12px]">{syncError}</p>
            {!marketingVersion && (
              <button
                type="button"
                onClick={() => void loadRequiredVersion()}
                className="text-brand-600 hover:text-brand-700 text-[12px] font-semibold underline underline-offset-2"
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={decline}
            disabled={!marketingVersion || versionLoading}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-surface-700 hover:bg-surface-100 transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!marketingVersion || versionLoading}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

export function openCookieSettings() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}
