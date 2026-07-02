'use client';

import { useEffect, useState, FormEvent } from 'react';
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

export default function DevSettingsPage() {
  const [settings, setSettings] = useState<DevSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Editable copies
  const [adsEnabled, setAdsEnabled] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [quietModeStart, setQuietModeStart] = useState('22:00');
  const [quietModeEnd, setQuietModeEnd] = useState('08:00');
  const [maxAdsPerHour, setMaxAdsPerHour] = useState(6);

  const fetchSettings = () => {
    setLoading(true);
    developerApi.getSettings()
      .then((res: any) => {
        const s = res.data;
        setSettings(s);
        setAdsEnabled(s.adsEnabled ?? true);
        setQuietMode(s.quietMode ?? false);
        setQuietModeStart(s.quietModeStart ?? '22:00');
        setQuietModeEnd(s.quietModeEnd ?? '08:00');
        setMaxAdsPerHour(s.maxAdsPerHour ?? 6);
      })
      .catch((err: any) => setError(err.response?.data?.message || 'Failed to load settings'))
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
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const res: any = await developerApi.exportData();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'waitlayer-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Export failed');
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
