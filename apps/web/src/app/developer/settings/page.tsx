'use client';

import type { AxiosResponse } from 'axios';
import { FormEvent, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components';
import { AccountErasure } from '@/components/account-erasure';
import { Notice, PageHeader, Panel, PanelHeader, Pill } from '@/components/dash';
import { GoogleAccountLink } from '@/components/google-account-link';
import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
import { NumberField } from '@/components/ui/number-field';
import { stringifyApiData } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/errors';
import { authApi, developerApi } from '@/lib/api/services';
import { useAuth } from '@/lib/auth-context';

import { AD_SERVING } from '@ateva/shared';
import { useToast } from '@ateva/ui';

/**
 * Mirrors the API's own bounds for `maxAdsPerHour`.
 */
const MAX_ADS_PER_HOUR_MIN = AD_SERVING.MAX_ADS_PER_HOUR_MIN;
const MAX_ADS_PER_HOUR_MAX = AD_SERVING.MAX_ADS_PER_HOUR_MAX;

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

interface SelfServiceExportPayload {
  exportMeta?: {
    truncated?: boolean;
  };
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
  const { user, isAuthenticated, refreshUser } = useAuth();
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
      const exportData = res.data as SelfServiceExportPayload;
      const blob = new Blob([stringifyApiData(exportData, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ateva-export.json';
      a.click();
      URL.revokeObjectURL(url);
      if (exportData.exportMeta?.truncated) {
        toast.info('Export downloaded. Some activity sections were capped; see exportMeta.');
      } else {
        toast.success('Export downloaded.');
      }
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

  const switchClass = (on: boolean) =>
    `relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--hair)] transition-colors motion-reduce:transition-none ${
      on ? 'bg-[var(--ink)]' : 'bg-[var(--page)]'
    }`;
  const thumbClass = (on: boolean) =>
    `absolute top-1 h-4 w-4 rounded-full transition-[left] motion-reduce:transition-none ${
      on ? 'left-6 bg-[var(--on-ink)]' : 'left-1 bg-[var(--muted)]'
    }`;
  const fieldLabel = 'mb-1.5 block text-sm font-medium';
  const eyebrowLabel = 'dash-eyebrow mb-1.5';

  return (
    <>
      <PageHeader title="Settings" />

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      {success && <Notice tone="ok">Settings saved successfully.</Notice>}

      {settings && (
        <form onSubmit={handleSave} className="grid gap-5">
          {/* Ad preferences */}
          <Panel label="Ad preferences">
            <PanelHeader title="Ad preferences" />
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Show ads while waiting</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Turn off to stop earning. No ads will appear in your IDE.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={adsEnabled}
                  onClick={() => setAdsEnabled(!adsEnabled)}
                  className={switchClass(adsEnabled)}
                >
                  <span className={thumbClass(adsEnabled)} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">Quiet mode</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Suppress ads during set hours
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={quietMode}
                  onClick={() => setQuietMode(!quietMode)}
                  className={switchClass(quietMode)}
                >
                  <span className={thumbClass(quietMode)} />
                </button>
              </div>

              {quietMode && (
                <>
                  <div className="grid grid-cols-2 gap-4 border-l-2 border-[var(--hair)] pl-4">
                    <div>
                      <label className={fieldLabel}>Quiet start</label>
                      <input
                        type="time"
                        value={quietModeStart}
                        onChange={(e) => setQuietModeStart(e.target.value)}
                        className="w-full px-4 py-3"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Quiet end</label>
                      <input
                        type="time"
                        value={quietModeEnd}
                        onChange={(e) => setQuietModeEnd(e.target.value)}
                        className="w-full px-4 py-3"
                      />
                    </div>
                  </div>
                  {/* A-058: quiet mode is evaluated in the developer's selected
                      timezone. Without a timezone we fall back to UTC, which is
                      rarely the developer's local wall-clock. */}
                  <div className="border-l-2 border-[var(--hair)] pl-4">
                    <label className={fieldLabel}>Timezone</label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-4 py-3"
                    >
                      <option value="">UTC (default)</option>
                      {[...buildTimezoneOptions(COMMON_TIMEZONES)].map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      Your quiet hours are evaluated in this timezone. Detected: {detectedTimezone}
                    </p>
                  </div>
                </>
              )}

              {/*
                  A typed field rather than a slider: this is a number the
                  developer already has in mind ("no more than four an hour"),
                  and a slider makes stating a known value a guessing game while
                  hiding what the permitted range even is.

                  Bounds mirror the API's own validation (`developer.dto.ts`:
                  @Min(1) @Max(12)). Anything outside is corrected on blur and
                  the range is stated in the hint rather than discovered by
                  dragging.
                */}
              <NumberField
                label="Max ads per hour"
                value={maxAdsPerHour}
                min={MAX_ADS_PER_HOUR_MIN}
                max={MAX_ADS_PER_HOUR_MAX}
                suffix="/ hr"
                hint={`How many sponsored units may be shown in an hour. Allowed range ${MAX_ADS_PER_HOUR_MIN}–${MAX_ADS_PER_HOUR_MAX}.`}
                onCommit={setMaxAdsPerHour}
              />

              {/* A-057: blocked category preferences persisted server-side */}
              <div>
                <label className={fieldLabel}>Blocked categories</label>
                <p className="mb-2 text-xs text-[var(--muted)]">
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
                  className="w-full px-4 py-3"
                />
                {blockedCategories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {blockedCategories.map((slug) => (
                      <Pill key={slug}>{slug}</Pill>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          {/* Account info */}
          <Panel label="Account">
            <PanelHeader title="Account" />
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <p className={eyebrowLabel}>Email</p>
                  <p className="text-sm font-medium text-[var(--ink)]">{settings.email}</p>
                </div>
                <div>
                  <p className={eyebrowLabel}>Email verification</p>
                  {emailVerified ? (
                    <Pill tone="ok">Verified</Pill>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Pill tone="warn">Not verified</Pill>
                      <button
                        type="button"
                        onClick={handleRequestVerification}
                        disabled={verifyBusy}
                        className="dash-btn dash-btn--secondary dash-btn--sm"
                      >
                        {verifyBusy ? 'Sending…' : 'Resend verification email'}
                      </button>
                    </div>
                  )}
                  {verifyMsg && <p className="mt-2 text-xs text-[var(--muted)]">{verifyMsg}</p>}
                </div>
                {settings.displayName && (
                  <div>
                    <p className={eyebrowLabel}>Name</p>
                    <p className="text-sm font-medium text-[var(--ink)]">{settings.displayName}</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-5 border-t border-[var(--hair)] pt-4 md:grid-cols-2">
                {settings.referralCode && (
                  <div>
                    <p className={eyebrowLabel}>Referral code</p>
                    <p className="dash-mono text-sm tracking-wider text-[var(--ink)]">
                      {settings.referralCode}
                    </p>
                  </div>
                )}
                <div>
                  <p className={eyebrowLabel}>GitHub</p>
                  {settings.githubLinked ? <Pill tone="ok">Linked</Pill> : <Pill>Not linked</Pill>}
                </div>
              </div>
            </div>
          </Panel>

          <GoogleAccountLink initiallyLinked={user?.googleVerified === true} />

          {/* Shared account security: all roles use the same API-accurate flow. */}
          <TwoFactorEnrolment
            initialEnabled={twoFactorEnabled}
            hasPassword={user?.hasPassword === true}
            accountEmail={user?.email ?? settings.email}
            onChange={(nextEnabled) => {
              setTwoFactorEnabled(nextEnabled);
              void refreshUser().catch(() => {
                // The mutation succeeded; the profile can recover on navigation.
              });
            }}
          />

          {/* API keys */}
          <Panel label="API keys">
            <PanelHeader
              title="API keys"
              action={
                <button
                  type="button"
                  onClick={handleCreateApiKey}
                  disabled={apiKeyBusy}
                  className="dash-btn dash-btn--primary dash-btn--sm"
                >
                  {apiKeyBusy ? 'Working...' : 'New ledger key'}
                </button>
              }
            />
            <p className="-mt-3 mb-4 text-xs text-[var(--muted)]">
              Manage read-only ledger keys for reporting integrations. Extension and CLI sign-in
              still use your user session.
            </p>

            {apiKeyError && (
              <div className="mb-4">
                <Notice tone="bad">{apiKeyError}</Notice>
              </div>
            )}

            {newApiKey && (
              <div className="mb-5">
                <Notice tone="ok" title="New ledger API key">
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-md border border-[var(--hair)] bg-[var(--page)] px-3 py-2 text-xs break-all text-[var(--ink)]">
                      {newApiKey}
                    </code>
                    <button
                      type="button"
                      onClick={copyNewApiKey}
                      className="dash-btn dash-btn--primary dash-btn--sm"
                    >
                      {copiedApiKey ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </Notice>
              </div>
            )}

            {apiKeys.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--hair)] py-8 text-center">
                <p className="text-sm text-[var(--muted)]">No API keys yet.</p>
              </div>
            ) : (
              <div
                className="overflow-x-auto rounded-lg border border-[var(--hair)]"
                tabIndex={0}
                role="region"
                aria-label="API keys table, scrolls horizontally"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Scopes</th>
                      <th>Created</th>
                      <th>Last used</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((key) => (
                      <tr key={key.id}>
                        <td className="dash-mono text-[var(--ink)]">{key.keyPrefix}...</td>
                        <td>{key.scopes.join(', ')}</td>
                        <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                        <td>
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="text-right">
                          {key.isActive ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeApiKey(key.id)}
                              disabled={apiKeyBusy}
                              className="dash-btn dash-btn--danger dash-btn--sm"
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">Revoked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
              Ledger keys can read earnings and payout ledger data with the
              <code className="mx-1 rounded bg-[var(--page)] px-1 py-0.5 text-[11px]">
                x-api-key
              </code>
              header. They cannot register extension devices, change settings, export data, delete
              your account, or request payouts.
            </p>
          </Panel>

          <AccountErasure
            role="developer"
            hasPassword={user?.hasPassword === true}
            twoFactorEnabled={twoFactorEnabled}
            accountEmail={user?.email ?? settings.email}
          />

          {/* Actions */}
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            Export downloads a recent self-service JSON snapshot. High-volume activity sections are
            capped and marked in <code>exportMeta</code>; contact support for a compliance-grade
            full export.
          </p>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="dash-btn dash-btn--primary dash-btn--md"
            >
              {saving ? 'Saving...' : 'Save settings'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="dash-btn dash-btn--secondary dash-btn--md"
            >
              Export my data
            </button>
          </div>
        </form>
      )}
    </>
  );
}
