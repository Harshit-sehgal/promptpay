import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runConfig } from './config';

const mocks = vi.hoisted(() => {
  const api = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  return {
    api,
    creds: {
      apiUrl: 'https://api.waitlayer.com/api/v1',
      token: 'tok',
      email: 'dev@test.com',
      role: 'developer',
    },
  };
});

vi.mock('../lib/credentials', () => ({
  getCredentials: vi.fn(() => mocks.creds),
}));

vi.mock('../lib/api-client', () => ({
  ApiClient: class {
    getSettings = mocks.api.getSettings;
    updateSettings = mocks.api.updateSettings;
  },
}));

vi.mock('../lib/prompt', () => ({
  prompt: vi.fn(),
}));

const { prompt } = (await import('../lib/prompt')) as { prompt: ReturnType<typeof vi.fn> };

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getSettings.mockResolvedValue({
    adsEnabled: true,
    quietMode: false,
    quietModeStart: null,
    quietModeEnd: null,
    maxAdsPerHour: 6,
    referralCode: 'ABC123',
    email: 'dev@test.com',
    displayName: 'Dev',
  });
  mocks.api.updateSettings.mockResolvedValue({});
  prompt.mockResolvedValue('4'); // default: return
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runConfig', () => {
  it('prints current settings on load', async () => {
    await runConfig();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('WaitLayer Settings');
    expect(output).toContain('Ads enabled');
    expect(output).toContain('ABC123');
  });

  it('disables ads when option 1 is chosen', async () => {
    mocks.api.updateSettings.mockResolvedValue({ adsEnabled: false });
    prompt.mockResolvedValueOnce('1');
    await runConfig();
    expect(mocks.api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ adsEnabled: false }),
    );
  });

  it('validates max-ads-per-hour is between 1 and 12', async () => {
    prompt.mockResolvedValueOnce('3').mockResolvedValueOnce('99');
    await expect(runConfig()).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('between 1 and 12'));
  });

  it('exits with a session-expired message on 401', async () => {
    mocks.api.getSettings.mockRejectedValue({ status: 401 });
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    await expect(runConfig()).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session expired'));
    vi.restoreAllMocks();
  });
});
