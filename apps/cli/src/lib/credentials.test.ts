import { afterEach, describe, expect, it, vi } from 'vitest';

const keytarMock = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

const readFileSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());
const renameSyncMock = vi.hoisted(() => vi.fn());
const chmodSyncMock = vi.hoisted(() => vi.fn());

vi.mock('keytar', () => ({
  default: keytarMock,
  ...keytarMock,
}));

vi.mock('fs', async () => {
  const actual = (await vi.importActual('fs')) as typeof import('fs');
  return {
    ...actual,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    renameSync: renameSyncMock,
    chmodSync: chmodSyncMock,
  };
});

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  return {
    ...actual,
    homedir: () => '/tmp/ateva-test-home',
  };
});

import {
  assertInsecureSecretStoreAllowed,
  getCredentials,
  getOrCreateInstallationId,
} from './credentials';

describe('getCredentials', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers credentials.json tokens over stale keychain tokens', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify({
        email: 'dev@example.com',
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        userId: 'user_123',
        role: 'developer',
      }),
    );
    keytarMock.getPassword.mockResolvedValueOnce(
      JSON.stringify({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }),
    );

    const creds = await getCredentials();

    expect(creds?.accessToken).toBe('fresh-access');
    expect(creds?.refreshToken).toBe('fresh-refresh');
    expect(creds?.email).toBe('dev@example.com');
    expect(keytarMock.getPassword).toHaveBeenCalledWith('ateva-cli', 'device-access-tokens');
    // The keychain should be re-synced with the authoritative credential-file tokens.
    expect(keytarMock.setPassword).toHaveBeenCalledWith(
      'ateva-cli',
      'device-access-tokens',
      JSON.stringify({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
    );
  });

  it('prefers credentials.json tokens over the plaintext .tokens fallback', async () => {
    readFileSyncMock
      .mockReturnValueOnce(
        JSON.stringify({
          email: 'dev@example.com',
          accessToken: 'fresh-access',
          refreshToken: 'fresh-refresh',
          userId: 'user_123',
          role: 'developer',
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({ accessToken: 'stale-access', refreshToken: 'stale-refresh' }),
      );
    keytarMock.getPassword.mockResolvedValueOnce(null);

    const creds = await getCredentials();

    expect(creds?.accessToken).toBe('fresh-access');
    expect(creds?.refreshToken).toBe('fresh-refresh');
  });

  it('falls back to the plaintext .tokens file when the credential file omits tokens and keychain is empty', async () => {
    readFileSyncMock
      .mockReturnValueOnce(
        JSON.stringify({
          email: 'dev@example.com',
          userId: 'user_123',
          role: 'developer',
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({ accessToken: 'fallback-access', refreshToken: 'fallback-refresh' }),
      );
    keytarMock.getPassword.mockResolvedValueOnce(null);

    const creds = await getCredentials();

    expect(creds?.accessToken).toBe('fallback-access');
    expect(creds?.refreshToken).toBe('fallback-refresh');
  });

  it('falls back to keychain tokens when the credential file omits them', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify({
        email: 'dev@example.com',
        userId: 'user_123',
        role: 'developer',
      }),
    );
    keytarMock.getPassword.mockResolvedValueOnce(
      JSON.stringify({ accessToken: 'keychain-access', refreshToken: 'keychain-refresh' }),
    );

    const creds = await getCredentials();

    expect(creds?.accessToken).toBe('keychain-access');
    expect(creds?.refreshToken).toBe('keychain-refresh');
  });

  it('returns null when no tokens are available anywhere', async () => {
    const notFound = new Error('ENOENT') as NodeJS.ErrnoException;
    notFound.code = 'ENOENT';

    readFileSyncMock
      .mockReturnValueOnce(
        JSON.stringify({
          email: 'dev@example.com',
          userId: 'user_123',
          role: 'developer',
        }),
      )
      .mockImplementationOnce(() => {
        throw notFound;
      });
    keytarMock.getPassword.mockResolvedValueOnce(null);

    const creds = await getCredentials();

    expect(creds).toBeNull();
  });

  it('creates and persists a random installation identity without host-derived material', async () => {
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const installationId = await getOrCreateInstallationId();

    expect(installationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(writeFileSyncMock).toHaveBeenCalledOnce();
    const [, serialized] = writeFileSyncMock.mock.calls[0] as [string, string];
    const persisted = JSON.parse(serialized) as { installationId: string };
    expect(persisted.installationId).toBe(installationId);
    expect(serialized).not.toContain('/tmp/ateva-test-home');
    expect(serialized).not.toContain('hostname');
    expect(renameSyncMock).toHaveBeenCalledOnce();
  });

  it('reuses a valid persisted installation identity', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify({
        email: 'dev@example.com',
        installationId: 'd7c4d9c5-4b73-4f98-9f33-54d6f8f0132b',
      }),
    );

    const installationId = await getOrCreateInstallationId();

    expect(installationId).toBe('d7c4d9c5-4b73-4f98-9f33-54d6f8f0132b');
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('does not re-sync the keychain when the stored tokens already match', async () => {
    readFileSyncMock.mockReturnValueOnce(
      JSON.stringify({
        email: 'dev@example.com',
        accessToken: 'same-access',
        refreshToken: 'same-refresh',
        userId: 'user_123',
        role: 'developer',
      }),
    );
    keytarMock.getPassword.mockResolvedValueOnce(
      JSON.stringify({ accessToken: 'same-access', refreshToken: 'same-refresh' }),
    );

    await getCredentials();

    expect(keytarMock.setPassword).not.toHaveBeenCalled();
  });
});

/**
 * The per-device HMAC signing key must not land on disk in a recoverable form
 * without the operator explicitly accepting that.
 *
 * The guard used to be `NODE_ENV === 'production'`, which never fired for the
 * people it protected: npm does not set NODE_ENV for `bin` scripts, so a
 * globally-installed CLI runs with it undefined. Anyone without a keychain
 * backend got the weak fallback silently — and got no warning at all when
 * keytar was absent rather than failing, because the warning only covered a
 * failed keychain write.
 */
describe('insecure secret-store fail-closed default', () => {
  // Tests the DECISION, not storeDeviceEventSecret itself. Calling that and
  // expecting a throw passes for the wrong reason wherever @napi-rs/keyring
  // resolves: it returns from the keychain branch first. The first version of
  // this suite did exactly that and CI reported "promise resolved instead of
  // rejecting" — the environment, not the logic, decided the result.

  it('refuses the weak on-disk fallback by default', () => {
    // No NODE_ENV involved. The old guard was `NODE_ENV === 'production'`,
    // which npm never sets for a bin script, so it never fired for the
    // globally-installed CLI it was written to protect.
    expect(() => assertInsecureSecretStoreAllowed({})).toThrow(/cannot be stored securely/);
    expect(() => assertInsecureSecretStoreAllowed({ NODE_ENV: 'production' })).toThrow();
    expect(() => assertInsecureSecretStoreAllowed({ NODE_ENV: 'development' })).toThrow();
  });

  it('names both the risk and the escape hatch in the error', () => {
    expect(() => assertInsecureSecretStoreAllowed({})).toThrow(
      /ATEVA_ALLOW_INSECURE_SECRET_STORE=1/,
    );
    expect(() => assertInsecureSecretStoreAllowed({})).toThrow(/keyring backend/);
  });

  it('allows it only on explicit opt-in, and warns every time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() =>
        assertInsecureSecretStoreAllowed({ ATEVA_ALLOW_INSECURE_SECRET_STORE: '1' }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0][0])).toMatch(/recover it/);
    } finally {
      warn.mockRestore();
    }
  });

  it('treats any value other than exactly "1" as not opted in', () => {
    for (const value of ['0', 'true', 'yes', '', ' 1']) {
      expect(() =>
        assertInsecureSecretStoreAllowed({ ATEVA_ALLOW_INSECURE_SECRET_STORE: value }),
      ).toThrow();
    }
  });
});
