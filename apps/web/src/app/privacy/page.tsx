'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api/client';
import { useAuth } from '@/lib/auth-context';

// Decision (A-009): server-side anonymous consent is intentionally NOT
// required for logged-out visitors. A logged-out CCPA opt-out is stored
// device-local only and the copy below says so explicitly. Authenticated
// users additionally record the preference server-side (A-036) via the
// consent ledger so the choice is auditable and honored across devices.
const CCPA_KEY = 'wl_ccpa_opt_out';
const CCPA_PURPOSE = 'ccpa_opt_out';

export default function PrivacyPage() {
  const { isAuthenticated } = useAuth();
  const [ccpaOptOut, setCcpaOptOut] = useState(false);
  const [ccpaVersion, setCcpaVersion] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadCurrentCcpaVersion = useCallback(async () => {
    if (ccpaVersion) return ccpaVersion;
    const { data } = await api.get<Record<string, string>>('/consent/required-versions');
    const version = data.privacy_policy ?? data.marketing_cookies;
    if (!version) {
      throw new Error('No current privacy policy version is available');
    }
    setCcpaVersion(version);
    return version;
  }, [ccpaVersion]);

  const loadServerState = useCallback(async () => {
    try {
      const { data } = await api.get(`/consent/${CCPA_PURPOSE}/status`);
      if (typeof data === 'boolean') setCcpaOptOut(data);
    } catch {
      // Fall back to the device-local value.
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCcpaOptOut(window.localStorage.getItem(CCPA_KEY) === 'true');
    }
    void loadCurrentCcpaVersion().catch(() => {
      // The authenticated toggle path will surface this if the user tries to
      // save before the current policy version can be fetched.
    });
    if (isAuthenticated) void loadServerState();
  }, [isAuthenticated, loadCurrentCcpaVersion, loadServerState]);

  const toggleCcpa = async () => {
    setSyncError(null);
    const next = !ccpaOptOut;

    if (!isAuthenticated) {
      setCcpaOptOut(next);
      window.localStorage.setItem(CCPA_KEY, String(next));
      return;
    }

    setSyncing(true);
    try {
      const version = await loadCurrentCcpaVersion();
      await api.post('/consent', {
        purpose: CCPA_PURPOSE,
        version,
        granted: next,
      });
      setCcpaOptOut(next);
      window.localStorage.setItem(CCPA_KEY, String(next));
    } catch {
      setSyncError('Could not save your account-level opt-out. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-surface-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-brand-500 hover:text-brand-600 text-[13px] font-medium">
          ← Back
        </Link>
        <h1 className="text-3xl font-bold text-surface-900 mt-4 mb-2 tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-surface-500 text-[14px] mb-10">Last updated: 2026-07-01</p>

        <section className="space-y-4 text-surface-600 text-[14px] leading-relaxed">
          <p>
            WaitLayer is a privacy-first private beta for AI coding assistant wait-state
            verification. Rewards and advertiser billing are disabled while independent attestation
            is completed. We never read your source code or prompts. We collect only the data needed
            to operate the service: your account email, payout details you provide, ad interaction
            events (hashed), and consent records.
          </p>
          <p>
            You can export a copy of your data at any time from your developer dashboard, and you
            may delete your account, which anonymizes your personal information. For details see our{' '}
            <Link
              href="/legal/gdpr-dpa"
              className="text-brand-500 hover:text-brand-600 underline underline-offset-2"
            >
              GDPR Data Processing Agreement
            </Link>
            .
          </p>
        </section>

        <section id="ccpa" className="mt-12 bg-white border border-surface-200 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-surface-900 mb-2">
            Your California Privacy Rights (CCPA)
          </h2>
          <p className="text-surface-600 text-[14px] leading-relaxed mb-4">
            Under the California Consumer Privacy Act you may opt out of the &ldquo;sale&rdquo; or
            sharing of your personal information. Toggle the switch below to record your &ldquo;Do
            Not Sell or Share My Personal Information&rdquo; preference on this device.
          </p>
          <div className="flex items-center justify-between">
            <span className="text-surface-700 text-[14px] font-medium">
              Do not sell or share my personal information
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={ccpaOptOut}
              aria-label="Do not sell my personal information"
              onClick={toggleCcpa}
              disabled={syncing}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                ccpaOptOut ? 'bg-brand-500' : 'bg-surface-300'
              } ${syncing ? 'opacity-60 cursor-wait' : ''}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  ccpaOptOut ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          <p className="text-surface-400 text-[12px] mt-3">
            {isAuthenticated
              ? ccpaOptOut
                ? 'Opt-out recorded on your account and this device.'
                : 'You have not opted out.'
              : ccpaOptOut
                ? 'Opt-out recorded on this device.'
                : 'You have not opted out on this device.'}
            {!isAuthenticated && ' This preference is stored locally on this browser only.'}
          </p>
          {syncError && <p className="text-red-600 text-[12px] mt-2">{syncError}</p>}
        </section>
      </div>
    </main>
  );
}
