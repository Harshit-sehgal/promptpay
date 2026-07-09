'use client';

import type { AxiosResponse } from 'axios';
import Image from 'next/image';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi, developerApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';

import { useToast } from '@waitlayer/ui';

interface DevSettings {
  adsEnabled: boolean;
  quietMode: boolean;
  quietModeStart?: string;
  quietModeEnd?: string;
  maxAdsPerHour: number;
  timezone?: string | null;
  blockedCategories?: string[];
  referralCode?: string;
  email: string;
  displayName?: string;
  githubLinked?: boolean;
  twoFactorEnabled?: boolean;
}

interface DeveloperApiKey {
  id: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

interface CreateApiKeyResponse extends DeveloperApiKey {
  plainKey: string;
}

// A-058: common IANA timezones offered for quiet mode. The browser can detect
// the user's local zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
// and surface it; if it isn't in the curated list below we prepend it.
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

// The browser-detected local timezone, surfaced as a UX hint so the user can
// pick the same zone as their IDE clock. Safe to compute once at module load.
const detectedTimezone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
})();

// A-058: returns the union of the curated common timezones and the browser-
// detected one (so a user whose local tz isn't in the common list still sees
// it as a selectable option). Duplicates are removed.
function buildTimezoneOptions(common: string[]): Set<string> {
  const set = new Set(common);
  if (detectedTimezone && detectedTimezone !== 'unknown') set.add(detectedTimezone);
  // 'UTC' is offered as the "default" labelled option, not in the list.
  set.delete('UTC');
  return set;
}

export default function DevSettingsPage() {
  const { user, isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<DevSettings | null>(null);
  const [apiKeys, setApiKeys] = useState<DeveloperApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [emailVerified, setEmailVerified] = useState<boolean>(!!user?.emailVerified);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const toast = useToast();

  // Editable copies
  const [adsEnabled, setAdsEnabled] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [quietModeStart, setQuietModeStart] = useState('22:00');
  const [quietModeEnd, setQuietModeEnd] = useState('08:00');
  const [maxAdsPerHour, setMaxAdsPerHour] = useState(6);
  const [timezone, setTimezone] = useState<string>(''); // '' = UTC unset / server default
  const [blockedCategories, setBlockedCategories] = useState<string[]>([]);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [show2faSetup, setShow2faSetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorSuccess, setTwoFactorSuccess] = useState<string | null>(null);

  const fetchSettings = () => {
    setLoading(true);
    Promise.all([
      developerApi.getSettings() as Promise<AxiosResponse<DevSettings>>,
      developerApi.listApiKeys() as Promise<AxiosResponse<DeveloperApiKey[]>>,
    ])
      .then(([settingsRes, apiKeysRes]) => {
        const s = settingsRes.data;
        setSettings(s);
        setApiKeys(apiKeysRes.data || []);
        setAdsEnabled(s.adsEnabled ?? false);
        setQuietMode(s.quietMode ?? false);
        setQuietModeStart(s.quietModeStart ?? '22:00');
        setQuietModeEnd(s.quietModeEnd ?? '08:00');
        setMaxAdsPerHour(s.maxAdsPerHour ?? 6);
        setTimezone(s.timezone ?? '');
        setBlockedCategories(s.blockedCategories ?? []);
        setTwoFactorEnabled(s.twoFactorEnabled ?? false);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load settings')))
      .finally(() => setLoading(false));
  };

  const handleStart2faSetup = async () => {
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    try {
      const res = await authApi.setup2fa();
      setTotpSecret(res.data.secret);
      setOtpauthUrl(res.data.otpauthUrl);
      setShow2faSetup(true);
    } catch (err: unknown) {
      setTwoFactorError(getErrorMessage(err, 'Failed to initialize 2FA setup'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleConfirm2faEnable = async () => {
    if (!verificationCode) return;
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    try {
      await authApi.enable2fa(verificationCode);
      setTwoFactorEnabled(true);
      setShow2faSetup(false);
      setVerificationCode('');
      setTwoFactorSuccess('Two-factor authentication enabled successfully.');
    } catch (err: unknown) {
      setTwoFactorError(getErrorMessage(err, 'Failed to verify code'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleConfirm2faDisable = async () => {
    if (!verificationCode) return;
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    try {
      await authApi.disable2fa(verificationCode);
      setTwoFactorEnabled(false);
      setShow2faSetup(false);
      setVerificationCode('');
      setTwoFactorSuccess('Two-factor authentication disabled successfully.');
    } catch (err: unknown) {
      setTwoFactorError(getErrorMessage(err, 'Failed to disable 2FA'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  // Keep the local email-verified flag in sync with the authenticated user.
  useEffect(() => {
    if (isAuthenticated) setEmailVerified(!!user?.emailVerified);
  }, [isAuthenticated, user?.emailVerified]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await developerApi.updateSettings({
        adsEnabled,
        quietMode,
        quietModeStart,
        quietModeEnd,
        maxAdsPerHour,
        timezone,
        blockedCategories,
      });
      setSuccess(true);
      toast.success('Settings saved successfully.');
      fetchSettings();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await developerApi.exportData();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'waitlayer-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Export failed'));
    }
  };

  const handleCreateApiKey = async () => {
    setApiKeyBusy(true);
    setApiKeyError(null);
    setNewApiKey(null);

    try {
      const res = (await developerApi.createLedgerApiKey()) as AxiosResponse<CreateApiKeyResponse>;
      setNewApiKey(res.data.plainKey);
      const keysRes = (await developerApi.listApiKeys()) as AxiosResponse<DeveloperApiKey[]>;
      setApiKeys(keysRes.data || []);
    } catch (err: unknown) {
      setApiKeyError(getErrorMessage(err, 'Failed to create API key'));
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    setApiKeyBusy(true);
    setApiKeyError(null);

    try {
      await developerApi.revokeApiKey(id);
      const keysRes = (await developerApi.listApiKeys()) as AxiosResponse<DeveloperApiKey[]>;
      setApiKeys(keysRes.data || []);
    } catch (err: unknown) {
      setApiKeyError(getErrorMessage(err, 'Failed to revoke API key'));
    } finally {
      setApiKeyBusy(false);
    }
  };

  const copyNewApiKey = () => {
    if (!newApiKey) return;
    navigator.clipboard.writeText(newApiKey);
    setCopiedApiKey(true);
    toast.success('API key copied to clipboard');
    setTimeout(() => setCopiedApiKey(false), 2000);
  };

  // A-015: self-service email verification request / resend. Payouts are
  // blocked until the email is verified, so developers must be able to trigger
  // the verification email themselves.
  const handleRequestVerification = async () => {
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      await authApi.requestEmailVerification();
      setVerifyMsg('Verification email sent. Check your inbox to confirm.');
      toast.success('Verification email sent.');
    } catch (err: unknown) {
      setVerifyMsg(getErrorMessage(err, 'Could not send verification email.'));
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 tracking-tight mb-2">Settings</h1>
        <p className="text-surface-500 text-[15px]">
          Control ad display, quiet hours, and data export
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200/60 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4 mb-6">
          <p className="text-emerald-600 text-sm">Settings saved successfully.</p>
        </div>
      )}

      {settings && (
        <form onSubmit={handleSave} className="space-y-8">
          {/* Ad preferences */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Ad preferences</h2>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-surface-900 font-semibold text-[14px]">
                    Show ads while waiting
                  </p>
                  <p className="text-surface-500 text-xs mt-0.5">
                    Turn off to stop earning — no ads will appear in your IDE
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={adsEnabled}
                  onClick={() => setAdsEnabled(!adsEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    adsEnabled ? 'bg-brand-500' : 'bg-surface-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      adsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-surface-900 font-semibold text-[14px]">Quiet mode</p>
                  <p className="text-surface-500 text-xs mt-0.5">Suppress ads during set hours</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={quietMode}
                  onClick={() => setQuietMode(!quietMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    quietMode ? 'bg-brand-500' : 'bg-surface-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      quietMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {quietMode && (
                <>
                  <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-surface-200">
                    <div>
                      <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                        Quiet start
                      </label>
                      <input
                        type="time"
                        value={quietModeStart}
                        onChange={(e) => setQuietModeStart(e.target.value)}
                        className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
                      />
                    </div>
                    <div>
                      <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                        Quiet end
                      </label>
                      <input
                        type="time"
                        value={quietModeEnd}
                        onChange={(e) => setQuietModeEnd(e.target.value)}
                        className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
                      />
                    </div>
                  </div>
                  {/* A-058: quiet mode is evaluated in the developer's selected
                      timezone. Without a timezone we fall back to UTC, which is
                      rarely the developer's local wall-clock. */}
                  <div className="pl-4 border-l-2 border-surface-200">
                    <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                      Timezone
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
                    >
                      <option value="">UTC (default)</option>
                      {[...buildTimezoneOptions(COMMON_TIMEZONES)].map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                    <p className="text-surface-500 text-xs mt-1.5">
                      Your quiet hours are evaluated in this timezone. Detected: {detectedTimezone}
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                  Max ads per hour
                </label>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={maxAdsPerHour}
                  onChange={(e) => setMaxAdsPerHour(Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-surface-400 text-xs mt-1.5 font-medium">
                  <span>1</span>
                  <span className="text-brand-600 font-mono font-bold">{maxAdsPerHour} / hr</span>
                  <span>12</span>
                </div>
              </div>

              {/* A-057: blocked category preferences persisted server-side */}
              <div>
                <label className="text-surface-700 text-sm font-medium mb-1.5 block">
                  Blocked categories
                </label>
                <p className="text-surface-500 text-xs mb-2">
                  Comma-separated category slugs (e.g. gambling, crypto). Ads from these categories
                  will never appear. These preferences are stored server-side and enforced even from
                  CLI/VSCode clients.
                </p>
                <input
                  type="text"
                  placeholder="e.g. gambling, crypto, adult"
                  value={blockedCategories.join(', ')}
                  onChange={(e) => {
                    const slugs = e.target.value
                      .split(',')
                      .map((s) =>
                        s
                          .trim()
                          .toLowerCase()
                          .replace(/[^a-z0-9_-]/g, ''),
                      )
                      .filter(Boolean);
                    setBlockedCategories(slugs);
                  }}
                  className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 focus:outline-none focus:border-brand-400"
                />
                {blockedCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {blockedCategories.map((slug) => (
                      <span
                        key={slug}
                        className="bg-surface-100 border border-surface-200 rounded-md px-2.5 py-1 text-surface-600 text-xs font-medium"
                      >
                        {slug}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Account info */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Account</h2>
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Email
                  </p>
                  <p className="text-surface-900 font-medium text-[15px]">{settings.email}</p>
                </div>
                <div>
                  <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    Email verification
                  </p>
                  {emailVerified ? (
                    <span className="bg-emerald-50 border border-emerald-200/60 text-emerald-600 text-xs font-semibold px-2.5 py-1 rounded-full">
                      Verified
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="bg-amber-50 border border-amber-200/60 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                        Not verified
                      </span>
                      <button
                        type="button"
                        onClick={handleRequestVerification}
                        disabled={verifyBusy}
                        className="text-brand-600 hover:text-brand-700 disabled:opacity-50 font-medium text-xs"
                      >
                        {verifyBusy ? 'Sending…' : 'Resend verification email'}
                      </button>
                    </div>
                  )}
                  {verifyMsg && <p className="text-surface-500 text-xs mt-2">{verifyMsg}</p>}
                </div>
                {settings.displayName && (
                  <div>
                    <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                      Name
                    </p>
                    <p className="text-surface-900 font-medium text-[15px]">
                      {settings.displayName}
                    </p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-surface-100 pt-4">
                {settings.referralCode && (
                  <div>
                    <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                      Referral code
                    </p>
                    <p className="text-surface-900 font-mono font-bold text-[15px] tracking-wider">
                      {settings.referralCode}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
                    GitHub
                  </p>
                  {settings.githubLinked ? (
                    <span className="bg-emerald-50 border border-emerald-200/60 text-emerald-600 text-xs font-semibold px-2.5 py-1 rounded-full">
                      Linked
                    </span>
                  ) : (
                    <span className="bg-surface-100 border border-surface-200 text-surface-500 text-xs font-semibold px-2.5 py-1 rounded-full">
                      Not linked
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Two-factor authentication */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">
              Two-factor authentication (2FA)
            </h2>
            <div className="space-y-6">
              {twoFactorError && (
                <div className="bg-red-50 border border-red-200/60 rounded-xl p-4">
                  <p className="text-red-600 text-sm">{twoFactorError}</p>
                </div>
              )}
              {twoFactorSuccess && (
                <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-4">
                  <p className="text-emerald-600 text-sm">{twoFactorSuccess}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-surface-900 font-semibold text-[14px]">
                    Status: {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                  </p>
                  <p className="text-surface-500 text-xs mt-0.5">
                    Secure your account with TOTP two-factor authentication. Required for payouts.
                  </p>
                </div>
                {!twoFactorEnabled && !show2faSetup && (
                  <button
                    type="button"
                    onClick={handleStart2faSetup}
                    disabled={twoFactorBusy}
                    className="bg-brand-500 hover:bg-brand-600 text-white font-medium px-4 py-2 rounded-lg text-[13px] transition-colors"
                  >
                    Enable 2FA
                  </button>
                )}
                {twoFactorEnabled && !show2faSetup && (
                  <button
                    type="button"
                    onClick={() => setShow2faSetup(true)}
                    className="text-rose-600 hover:text-rose-700 font-medium text-[13px]"
                  >
                    Disable 2FA
                  </button>
                )}
              </div>

              {/* Setup / Disable form */}
              {show2faSetup && (
                <div className="border-t border-surface-100 pt-5 mt-5 space-y-5">
                  {!twoFactorEnabled ? (
                    <>
                      <p className="text-surface-900 font-semibold text-[14px]">
                        Set up Authenticator app
                      </p>
                      <ol className="list-decimal pl-5 text-surface-600 text-xs space-y-2">
                        <li>
                          Scan the QR code below or manually enter the key into your authenticator
                          app (Google Authenticator, Authy, etc.).
                        </li>
                        <li>Enter the 6-digit code from your app below to verify setup.</li>
                      </ol>

                      <div className="flex flex-col sm:flex-row items-center gap-6 py-3">
                        {otpauthUrl && (
                          <div className="bg-white p-3 border border-surface-200 rounded-xl shadow-sm">
                            <Image
                              src={`https://chart.googleapis.com/chart?chs=160x160&chld=M|0&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`}
                              alt="Scan to pair TOTP"
                              width={160}
                              height={160}
                              unoptimized
                            />
                          </div>
                        )}
                        <div className="space-y-2 text-center sm:text-left">
                          <p className="text-surface-500 text-xs uppercase font-semibold">
                            Secret Key
                          </p>
                          <code className="bg-surface-50 border border-surface-200 rounded-md px-3 py-1.5 text-surface-900 text-xs font-mono select-all block break-all">
                            {totpSecret}
                          </code>
                        </div>
                      </div>

                      <div className="max-w-xs space-y-3">
                        <label className="text-surface-700 text-sm font-medium block">
                          Verification code
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="000000"
                            maxLength={6}
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                            className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-center font-mono font-bold tracking-[0.2em] focus:outline-none focus:border-brand-400"
                          />
                          <button
                            type="button"
                            onClick={handleConfirm2faEnable}
                            disabled={twoFactorBusy || verificationCode.length !== 6}
                            className="bg-surface-900 hover:bg-surface-800 disabled:opacity-50 text-white font-medium px-5 py-3 rounded-xl text-sm transition-colors shrink-0"
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="max-w-xs space-y-3">
                      <p className="text-surface-900 font-semibold text-[14px]">
                        Confirm Disabling 2FA
                      </p>
                      <p className="text-surface-500 text-xs">
                        Enter the current code from your authenticator app to disable 2FA.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="000000"
                          maxLength={6}
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                          className="w-full bg-surface-50 border border-surface-200 rounded-xl px-4 py-3 text-surface-900 text-center font-mono font-bold tracking-[0.2em] focus:outline-none focus:border-brand-400"
                        />
                        <button
                          type="button"
                          onClick={handleConfirm2faDisable}
                          disabled={twoFactorBusy || verificationCode.length !== 6}
                          className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-medium px-5 py-3 rounded-xl text-sm transition-colors shrink-0"
                        >
                          Disable
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShow2faSetup(false);
                        setVerificationCode('');
                        setTwoFactorError(null);
                      }}
                      className="text-surface-500 hover:text-surface-700 font-medium text-xs px-3 py-1.5 rounded-lg border border-surface-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* API keys */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-surface-900 font-bold text-[16px]">API keys</h2>
                <p className="text-surface-500 text-xs mt-1">
                  Manage read-only ledger keys for reporting integrations. Extension and CLI sign-in still use your user session.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateApiKey}
                disabled={apiKeyBusy}
                className="bg-surface-900 hover:bg-surface-800 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-[13px] transition-colors"
              >
                {apiKeyBusy ? 'Working...' : 'New ledger key'}
              </button>
            </div>

            {apiKeyError && (
              <div className="bg-red-50 border border-red-200/60 rounded-lg p-3 mb-4">
                <p className="text-red-600 text-sm">{apiKeyError}</p>
              </div>
            )}

            {newApiKey && (
              <div className="bg-emerald-50 border border-emerald-200/70 rounded-lg p-4 mb-5">
                <p className="text-emerald-700 text-xs font-semibold uppercase tracking-wider mb-2">
                  New ledger API key
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 bg-white border border-emerald-200/70 rounded-md px-3 py-2 text-surface-900 text-xs break-all font-mono">
                    {newApiKey}
                  </code>
                  <button
                    type="button"
                    onClick={copyNewApiKey}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-2 rounded-md text-xs transition-colors shrink-0"
                  >
                    {copiedApiKey ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {apiKeys.length === 0 ? (
              <div className="border border-dashed border-surface-200 rounded-lg py-8 text-center">
                <p className="text-surface-500 text-sm">No API keys yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-surface-200/80 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50/70 border-b border-surface-200/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-surface-500 font-medium">Key</th>
                      <th className="px-4 py-3 text-left text-surface-500 font-medium">Scopes</th>
                      <th className="px-4 py-3 text-left text-surface-500 font-medium">Created</th>
                      <th className="px-4 py-3 text-left text-surface-500 font-medium">
                        Last used
                      </th>
                      <th className="px-4 py-3 text-right text-surface-500 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {apiKeys.map((key) => (
                      <tr key={key.id}>
                        <td className="px-4 py-3 font-mono text-surface-900">{key.keyPrefix}...</td>
                        <td className="px-4 py-3 text-surface-600">{key.scopes.join(', ')}</td>
                        <td className="px-4 py-3 text-surface-500">
                          {new Date(key.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-surface-500">
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {key.isActive ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeApiKey(key.id)}
                              disabled={apiKeyBusy}
                              className="text-rose-600 hover:text-rose-700 disabled:opacity-50 font-medium text-xs transition-colors"
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-surface-400 text-xs">Revoked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-surface-400 text-xs mt-3 leading-relaxed">
              Ledger keys can read earnings and payout ledger data with the
              <code className="mx-1 rounded bg-surface-100 px-1 py-0.5 font-mono text-[11px]">x-api-key</code>
              header. They cannot register extension devices, change settings, export data, delete your account, or request payouts.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-xl text-[14px] shadow-sm shadow-brand-500/10 transition-colors"
            >
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="bg-surface-50 border border-surface-200 text-surface-600 hover:bg-surface-100/50 hover:text-surface-900 font-medium px-6 py-2.5 rounded-xl text-[14px] transition-colors"
            >
              Export my data
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
