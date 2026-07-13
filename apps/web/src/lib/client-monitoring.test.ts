import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
}));

vi.mock('@sentry/nextjs', () => sentry);

function installBrowserStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  return localStorage;
}

describe('consent-gated client monitoring', () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    installBrowserStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
    if (originalDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
  });

  async function modules() {
    const preferences = await import('./consent-preferences');
    const monitoring = await import('./client-monitoring');
    return { preferences, monitoring };
  }

  it('initializes exactly once for accepted consent at the server-required version', async () => {
    const { preferences, monitoring } = await modules();
    preferences.writeStoredCookieConsent('accepted', 'v2');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ marketing_cookies: 'v2' }), { status: 200 }),
        ),
    );

    await monitoring.initializeMonitoringFromStoredConsent();
    await monitoring.initializeMonitoringFromStoredConsent();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['declined', 'v2'],
    ['accepted', 'v1'],
    ['accepted', null],
  ] as const)('does not initialize for %s consent at version %s', async (choice, version) => {
    const { preferences, monitoring } = await modules();
    preferences.writeStoredCookieConsent(choice, version);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ marketing_cookies: 'v2' }), { status: 200 }),
        ),
    );
    await monitoring.initializeMonitoringFromStoredConsent();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('fails closed when required-version lookup fails', async () => {
    const { preferences, monitoring } = await modules();
    preferences.writeStoredCookieConsent('accepted', 'v2');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await monitoring.initializeMonitoringFromStoredConsent();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('closes on decline and can initialize again after a later current re-acceptance', async () => {
    const { preferences, monitoring } = await modules();
    preferences.writeStoredCookieConsent('accepted', 'v2');
    monitoring.enableClientMonitoring('v2');
    expect(sentry.init).toHaveBeenCalledTimes(1);

    preferences.writeStoredCookieConsent('declined', 'v2');
    monitoring.disableClientMonitoring();
    expect(sentry.close).toHaveBeenCalledTimes(1);

    preferences.writeStoredCookieConsent('accepted', 'v2');
    monitoring.enableClientMonitoring('v2');
    expect(sentry.init).toHaveBeenCalledTimes(2);
  });
});
