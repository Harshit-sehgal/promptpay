import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `getDashboardUrl()` derives the web dashboard origin from the configured
 * API URL so staging/dev installs open the matching dashboard. It had no spec
 * at all (AGENTS.md note) while its catch-path once returned a page on
 * `ateva.com` — a domain this project does not own.
 *
 * Reachable branches: the derived host (with/without an `api.` prefix) and
 * the fallback that getApiUrl's validation produces for rejected values.
 */

const mock = vi.hoisted(() => ({ configured: undefined as string | undefined }));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: () => mock.configured }),
  },
  ConfigurationTarget: { Global: 1 },
}));

async function dashboardUrl(value: string | undefined): Promise<string> {
  mock.configured = value;
  const { ConfigurationManager } = await import('./config');
  return new ConfigurationManager({
    get: async () => undefined,
    store: async () => undefined,
    delete: async () => undefined,
    onDidChange: () => ({ dispose() {} }),
  } as never).getDashboardUrl();
}

describe('ConfigurationManager.getDashboardUrl', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('derives the web origin from the shipped default API URL', async () => {
    // `ateva.vercel.app` carries no `api.` prefix, so the host is used as-is —
    // which is exactly where the production dashboard lives.
    await expect(dashboardUrl(undefined)).resolves.toBe('https://ateva.vercel.app/developer');
    await expect(dashboardUrl('')).resolves.toBe('https://ateva.vercel.app/developer');
  });

  it('strips an api. prefix from a custom host', async () => {
    await expect(dashboardUrl('https://api.staging.example.com/api/v1')).resolves.toBe(
      'https://staging.example.com/developer',
    );
  });

  it('keeps the scheme of a loopback development API', async () => {
    await expect(dashboardUrl('http://localhost:4002/api/v1')).resolves.toBe(
      'http://localhost:4002/developer',
    );
  });

  it('falls back to the production dashboard when the configured value is rejected', async () => {
    // Plain HTTP on a remote host is refused by getApiUrl's validation, so the
    // dashboard is derived from the DEFAULT origin, never from attacker input.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(dashboardUrl('http://evil.example/api/v1')).resolves.toBe(
      'https://ateva.vercel.app/developer',
    );
    await expect(dashboardUrl('not a url')).resolves.toBe('https://ateva.vercel.app/developer');
  });
});
