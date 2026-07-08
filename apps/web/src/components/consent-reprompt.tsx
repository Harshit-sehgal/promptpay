'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api/client';
import { useAuth } from '@/lib/auth-context';

const VERSION = '2026-07-01';

export default function ConsentRePrompt() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [stale, setStale] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      const { data } = await api.get<string[]>('/consent/stale');
      setStale(Array.isArray(data) ? data : []);
    } catch {
      setStale([]);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void check();
  }, [isAuthenticated, check]);

  if (!isAuthenticated || stale.length === 0 || dismissed) return null;

  const acceptAll = async () => {
    setBusy(true);
    try {
      await Promise.all(
        stale.map((purpose) =>
          api.post('/consent', {
            purpose,
            version: VERSION,
            granted: true,
            metadata: { method: 're_prompt' },
          }),
        ),
      );
      setStale([]);
    } catch {
      // Keep the banner up if the server sync failed.
    } finally {
      setBusy(false);
    }
  };

  const review = () => {
    setDismissed(true);
    router.push('/privacy');
  };

  return (
    <div
      role="alert"
      aria-label="Consent update required"
      className="fixed top-0 inset-x-0 z-50 px-4 pt-4 sm:px-6"
    >
      <div className="mx-auto max-w-3xl bg-white border border-brand-200 rounded-2xl shadow-lg shadow-surface-300/30 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="text-surface-600 text-[13px] leading-relaxed flex-1">
          Our Privacy Policy and Terms have been updated. Please review and
          re-accept to keep your account in good standing.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={review}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-surface-600 hover:bg-surface-100 transition-colors"
          >
            Review
          </button>
          <button
            type="button"
            onClick={acceptAll}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium bg-brand-500 hover:bg-brand-600 text-white transition-colors disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
