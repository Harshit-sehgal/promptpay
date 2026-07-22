import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

/**
 * Shared, mutable VS Code mock state. Because `vi.mock` factories are hoisted
 * above all imports, the state object is created via `vi.hoisted` so it is
 * available inside the factory and can be reset between tests.
 */
const mock = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  secrets: {} as Record<string, string>,
}));

vi.mock('vscode', () => {
  // A single stable configuration object so the same `update`/get spies are
  // reused across calls (mirrors how VS Code returns one config per section).
  const cfg = {
    get: (key: string, def?: unknown) => (mock.config[key] !== undefined ? mock.config[key] : def),
    update: vi.fn(async (key: string, value: unknown) => {
      mock.config[key] = value;
    }),
    has: vi.fn(() => true),
  };
  return {
    workspace: { getConfiguration: vi.fn(() => cfg) },
    env: { machineId: 'test-machine-id' },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  };
});

import { ConfigurationManager } from '../src/config';

function makeSecrets(): vscode.SecretStorage {
  return {
    get: vi.fn(async (key: string) => mock.secrets[key] ?? null),
    store: vi.fn(async (key: string, value: string) => {
      mock.secrets[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete mock.secrets[key];
    }),
  } as unknown as vscode.SecretStorage;
}

function makeManager(): ConfigurationManager {
  return new ConfigurationManager(makeSecrets());
}

beforeEach(() => {
  mock.config = {};
  mock.secrets = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfigurationManager — settings parsing & validation', () => {
  it('resolves the API base URL from settings, falling back to the SaaS default', () => {
    const mgr = makeManager();

    mock.config['apiUrl'] = 'https://api.example.com/api/v1';
    expect(mgr.getApiUrl()).toBe('https://api.example.com/api/v1');

    delete mock.config['apiUrl'];
    expect(mgr.getApiUrl()).toBe('https://api.waitlayer.com/api/v1');
  });

  it('reads adsEnabled as a boolean and defaults to disabled (opt-in required)', async () => {
    const mgr = makeManager();

    expect(await mgr.adsEnabled()).toBe(false);

    mock.config['adsEnabled'] = false;
    expect(await mgr.adsEnabled()).toBe(false);

    mock.config['adsEnabled'] = true;
    expect(await mgr.adsEnabled()).toBe(true);
  });

  it('toggles ads on then off, persisting each value globally', async () => {
    const mgr = makeManager();

    expect(await mgr.adsEnabled()).toBe(false); // default off (opt-in required)

    // First toggle: off → on (enabled)
    const afterOn = await mgr.toggleAds();
    expect(afterOn).toBe(true);
    expect(await mgr.adsEnabled()).toBe(true);
    expect(mock.config['adsEnabled']).toBe(true);

    // Second toggle: on → off (disabled)
    const afterOff = await mgr.toggleAds();
    expect(afterOff).toBe(false);
    expect(mock.config['adsEnabled']).toBe(false);
  });

  it('keeps wait telemetry opt-in only and persists an explicit toggle', async () => {
    const mgr = makeManager();

    expect(await mgr.waitTelemetryEnabled()).toBe(false);
    expect(await mgr.toggleWaitTelemetry()).toBe(true);
    expect(await mgr.waitTelemetryEnabled()).toBe(true);
    expect(mock.config['waitTelemetryEnabled']).toBe(true);
    expect(await mgr.toggleWaitTelemetry()).toBe(false);
  });

  it('reads maxAdsPerHour, defaulting to 6', async () => {
    const mgr = makeManager();

    expect(await mgr.getMaxAdsPerHour()).toBe(6);

    mock.config['maxAdsPerHour'] = 3;
    expect(await mgr.getMaxAdsPerHour()).toBe(3);
  });

  it('reads inactivityTimeoutMs, defaulting to 15_000ms', () => {
    const mgr = makeManager();

    expect(mgr.getInactivityTimeoutMs()).toBe(15_000);

    mock.config['inactivityTimeoutMs'] = 5_000;
    expect(mgr.getInactivityTimeoutMs()).toBe(5_000);
  });

  it('reports quiet hours only when enabled and the current time is inside the window', async () => {
    const mgr = makeManager();

    // Disabled → never in quiet hours regardless of the clock.
    mock.config['quietMode.enabled'] = false;
    expect(await mgr.inQuietHours()).toBe(false);

    // Enabled with an all-day window (00:00–23:59) always contains "now".
    mock.config['quietMode.enabled'] = true;
    mock.config['quietMode.start'] = '00:00';
    mock.config['quietMode.end'] = '23:59';
    expect(await mgr.inQuietHours()).toBe(true);
  });
});

describe('ConfigurationManager — token storage', () => {
  it('returns null tokens when nothing has been stored', async () => {
    const mgr = makeManager();
    expect(await mgr.getTokens()).toBeNull();
  });

  it('round-trips stored tokens through SecretStorage', async () => {
    const mgr = makeManager();
    const tokens = { accessToken: 'a-tok', refreshToken: 'r-tok' };

    await mgr.storeTokens(tokens);
    expect(await mgr.getTokens()).toEqual(tokens);
  });

  it('clears stored tokens', async () => {
    const mgr = makeManager();
    await mgr.storeTokens({ accessToken: 'a', refreshToken: 'r' });

    await mgr.clearTokens();
    expect(await mgr.getTokens()).toBeNull();
  });

  it('propagates token persistence failures to the auth caller', async () => {
    const failure = new Error('secret store unavailable');
    const secrets = makeSecrets();
    vi.mocked(secrets.store).mockRejectedValueOnce(failure);
    const mgr = new ConfigurationManager(secrets);

    await expect(mgr.storeTokens({ accessToken: 'a', refreshToken: 'r' })).rejects.toBe(failure);
  });

  it('propagates token deletion failures to the logout caller', async () => {
    const failure = new Error('secret delete unavailable');
    const secrets = makeSecrets();
    vi.mocked(secrets.delete).mockRejectedValueOnce(failure);
    const mgr = new ConfigurationManager(secrets);

    await expect(mgr.clearTokens()).rejects.toBe(failure);
  });
});

describe('ConfigurationManager — device fingerprint', () => {
  it('generates a stable fingerprint from the machine id and persists it', async () => {
    const mgr = makeManager();

    const first = await mgr.getDeviceFingerprint();
    expect(first).toMatch(/^[0-9a-f]{64}$/); // sha256 hex

    // Second call returns the same value (read from persisted SecretStorage).
    const second = await mgr.getDeviceFingerprint();
    expect(second).toBe(first);
    expect(mock.secrets['waitlayer.deviceFingerprint']).toBe(first);
  });
});

describe('ConfigurationManager — device registration storage', () => {
  it('attempts every cleanup key and then propagates a deletion failure', async () => {
    const failure = new Error('secret delete unavailable');
    const secrets = makeSecrets();
    vi.mocked(secrets.delete).mockRejectedValueOnce(failure);
    const mgr = new ConfigurationManager(secrets);

    await expect(mgr.clearDeviceRegistration()).rejects.toBe(failure);
    expect(secrets.delete).toHaveBeenCalledTimes(3);
  });
});

describe('ConfigurationManager — detector rollout, kill switch & suppression (P1.17 / P1.18)', () => {
  it('detectorRolloutPercent defaults to 100 and clamps to 0–100', () => {
    const mgr = makeManager();
    expect(mgr.detectorRolloutPercent()).toBe(100);

    mock.config['detectorRolloutPercent'] = 25;
    expect(mgr.detectorRolloutPercent()).toBe(25);

    mock.config['detectorRolloutPercent'] = 250;
    expect(mgr.detectorRolloutPercent()).toBe(100);

    mock.config['detectorRolloutPercent'] = -5;
    expect(mgr.detectorRolloutPercent()).toBe(0);

    mock.config['detectorRolloutPercent'] = NaN;
    expect(mgr.detectorRolloutPercent()).toBe(100);
  });

  it('getDisabledDetectorSources defaults to an empty list', () => {
    const mgr = makeManager();
    expect(mgr.getDisabledDetectorSources()).toEqual([]);

    mock.config['disabledDetectorSources'] = ['inactivity', 'Task'];
    expect(mgr.getDisabledDetectorSources()).toEqual(['inactivity', 'task']);
  });

  it('toggleDetectorSource adds then removes a normalized source and persists it', async () => {
    const mgr = makeManager();
    expect(mgr.getDisabledDetectorSources()).toEqual([]);

    const afterAdd = await mgr.toggleDetectorSource('Inactivity');
    expect(afterAdd).toEqual(['inactivity']);
    expect(mgr.getDisabledDetectorSources()).toEqual(['inactivity']);

    const afterRemove = await mgr.toggleDetectorSource('INACTIVITY');
    expect(afterRemove).toEqual([]);
    expect(mgr.getDisabledDetectorSources()).toEqual([]);
  });

  it('falsePositiveSuppressionMinutes defaults to 30 and clamps to >= 0', () => {
    const mgr = makeManager();
    expect(mgr.falsePositiveSuppressionMinutes()).toBe(30);

    mock.config['falsePositiveSuppressionMinutes'] = 10;
    expect(mgr.falsePositiveSuppressionMinutes()).toBe(10);

    mock.config['falsePositiveSuppressionMinutes'] = -3;
    expect(mgr.falsePositiveSuppressionMinutes()).toBe(0);

    mock.config['falsePositiveSuppressionMinutes'] = NaN;
    expect(mgr.falsePositiveSuppressionMinutes()).toBe(30);
  });

  it('preferredDisplayCurrency defaults to empty and is uppercased/trimmed (P1.4)', () => {
    const mgr = makeManager();
    expect(mgr.preferredDisplayCurrency()).toBe('');

    mock.config['preferredDisplayCurrency'] = 'usd';
    expect(mgr.preferredDisplayCurrency()).toBe('USD');

    mock.config['preferredDisplayCurrency'] = '   ';
    expect(mgr.preferredDisplayCurrency()).toBe('');
  });
});
