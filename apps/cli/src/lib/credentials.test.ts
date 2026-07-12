import { afterEach, describe, expect, it, vi } from 'vitest';

const keytarMock = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

const readFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('keytar', () => ({
  default: keytarMock,
  ...keytarMock,
}));

vi.mock('fs', async () => {
  const actual = (await vi.importActual('fs')) as typeof import('fs');
  return {
    ...actual,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  return {
    ...actual,
    homedir: () => '/tmp/waitlayer-test-home',
  };
});

import { getCredentials } from './credentials';

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
    expect(keytarMock.getPassword).toHaveBeenCalledWith('waitlayer-cli', 'device-access-tokens');
    // The keychain should be re-synced with the authoritative credential-file tokens.
    expect(keytarMock.setPassword).toHaveBeenCalledWith(
      'waitlayer-cli',
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
