'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/lib/api/client';
import { useAuth } from '@/lib/auth-context';

import { useToast } from '@waitlayer/ui';

const STORAGE_KEY = 'wl_cookie_consent';
const OPEN_EVENT = 'wl:open-cookie-settings';

type Choice = 'accepted' | 'declined';

function readStored(): Choice | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw).choice as Choice) ?? null;
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  const { isAuthenticated } = useAuth();
  const [visible, setVisible] = useState(false);
  const [marketingVersion, setMarketingVersion] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const { success } = useToast();

  useEffect(() => {
    if (!readStored()) setVisible(true);

    const reopen = () => setVisible(true);
    window.addEventListener(OPEN_EVENT, reopen);

    // Resolve the server-required marketing_cookies version so the recorded
    // consent matches the current policy version (rather than a hard-coded
    // constant that drifts from the backend).
    api
      .get<Record<string, string>>('/consent/required-versions')
      .then((res) => {
        if (res.data?.marketing_cookies) setMarketingVersion(res.data.marketing_cookies);
      })
      .catch(() => undefined);

    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, []);

  const persist = (choice: Choice) => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ choice, at: new Date().toISOString(), version: marketingVersion }),
    );
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

  const choose = async (choice: Choice) => {
    setSyncError(null);
    if (isAuthenticated) {
      try {
        await recordConsent(choice === 'accepted');
      } catch {
        setSyncError('Could not save cookie preferences to your account. Please try again.');
        return;
      }
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
      <div className="mx-auto max-w-3xl bg-white border border-surface-200 rounded-2xl shadow-lg shadow-surface-300/30 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="text-surface-600 text-[13px] leading-relaxed flex-1">
          We use essential cookies to keep you signed in and optional analytics
          cookies to improve WaitLayer. See our{' '}
          <Link href="/privacy" className="text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          for details.
        </p>
        {syncError && <p className="text-red-600 text-[12px]">{syncError}</p>}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={decline}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-surface-600 hover:bg-surface-100 transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={accept}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium bg-brand-500 hover:bg-brand-600 text-white transition-colors"
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
