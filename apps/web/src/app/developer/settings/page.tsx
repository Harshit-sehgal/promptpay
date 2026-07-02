'use client';

import { useEffect, useState, FormEvent } from 'react';
import type { AxiosResponse } from 'axios';
import { LoadingSpinner } from '@/components';
import { developerApi } from '@/lib/api/services';

interface DevSettings {
  adsEnabled: boolean;
  quietMode: boolean;
  quietModeStart?: string;
  quietModeEnd?: string;
  maxAdsPerHour: number;
  referralCode?: string;
  email: string;
  displayName?: string;
  githubLinked?: boolean;
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

function getErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: { message?: unknown } };
    message?: unknown;
  };
  const message = candidate.response?.data?.message ?? candidate.message;

  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string') return message;
  return fallback;
}

export default function DevSettingsPage() {
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

  // Editable copies
  const [adsEnabled, setAdsEnabled] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [quietModeStart, setQuietModeStart] = useState('22:00');
  const [quietModeEnd, setQuietModeEnd] = useState('08:00');
  const [maxAdsPerHour, setMaxAdsPerHour] = useState(6);

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
        setAdsEnabled(s.adsEnabled ?? true);
        setQuietMode(s.quietMode ?? false);
        setQuietModeStart(s.quietModeStart ?? '22:00');
        setQuietModeEnd(s.quietModeEnd ?? '08:00');
        setMaxAdsPerHour(s.maxAdsPerHour ?? 6);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load settings')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

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
      });
      setSuccess(true);
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
      const res = (await developerApi.createApiKey({
        scopes: ['extension:write', 'ledger:read'],
      })) as AxiosResponse<CreateApiKeyResponse>;
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
    setTimeout(() => setCopiedApiKey(false), 2000);
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
                  <p className="text-surface-900 font-semibold text-[14px]">Show ads while waiting</p>
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
                  <p className="text-surface-500 text-xs mt-0.5">
                    Suppress ads during set hours
                  </p>
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
            </div>
          </div>

          {/* Account info */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <h2 className="text-surface-900 font-bold text-[16px] mb-5">Account</h2>
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Email</p>
                  <p className="text-surface-900 font-medium text-[15px]">{settings.email}</p>
                </div>
                {settings.displayName && (
                  <div>
                    <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Name</p>
                    <p className="text-surface-900 font-medium text-[15px]">{settings.displayName}</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-surface-100 pt-4">
                {settings.referralCode && (
                  <div>
                    <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">Referral code</p>
                    <p className="text-surface-900 font-mono font-bold text-[15px] tracking-wider">{settings.referralCode}</p>
                  </div>
                )}
                <div>
                  <p className="text-surface-500 text-xs font-semibold uppercase tracking-wider mb-1.5">GitHub</p>
                  {settings.githubLinked ? (
                    <span className="bg-emerald-50 border border-emerald-200/60 text-emerald-600 text-xs font-semibold px-2.5 py-1 rounded-full">Linked</span>
                  ) : (
                    <span className="bg-surface-100 border border-surface-200 text-surface-500 text-xs font-semibold px-2.5 py-1 rounded-full">Not linked</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* API keys */}
          <div className="bg-white border border-surface-200/80 rounded-2xl p-7 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-surface-900 font-bold text-[16px]">API keys</h2>
                <p className="text-surface-500 text-xs mt-1">Manage keys for extension and CLI integrations.</p>
              </div>
              <button
                type="button"
                onClick={handleCreateApiKey}
                disabled={apiKeyBusy}
                className="bg-surface-900 hover:bg-surface-800 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-[13px] transition-colors"
              >
                {apiKeyBusy ? 'Working...' : 'New key'}
              </button>
            </div>

            {apiKeyError && (
              <div className="bg-red-50 border border-red-200/60 rounded-lg p-3 mb-4">
                <p className="text-red-600 text-sm">{apiKeyError}</p>
              </div>
            )}

            {newApiKey && (
              <div className="bg-emerald-50 border border-emerald-200/70 rounded-lg p-4 mb-5">
                <p className="text-emerald-700 text-xs font-semibold uppercase tracking-wider mb-2">New API key</p>
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
                      <th className="px-4 py-3 text-left text-surface-500 font-medium">Last used</th>
                      <th className="px-4 py-3 text-right text-surface-500 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {apiKeys.map((key) => (
                      <tr key={key.id}>
                        <td className="px-4 py-3 font-mono text-surface-900">{key.keyPrefix}...</td>
                        <td className="px-4 py-3 text-surface-600">
                          {key.scopes.join(', ')}
                        </td>
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
