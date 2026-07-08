import { describe, expect, it } from 'vitest';

import { ApiClient, resolveApiBaseUrl } from './api-client';
import { Credentials } from './credentials';

const creds: Credentials = {
  email: 'dev@example.com',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  userId: 'user_123',
  role: 'developer',
};

function raw(client: ApiClient, url: string) {
  return (client as unknown as {
    raw<T>(method: 'GET' | 'POST' | 'PATCH', path: string): Promise<T>;
  }).raw('GET', url);
}

describe('ApiClient transport policy', () => {
  it('refuses cleartext requests to non-loopback hosts', async () => {
    await expect(raw(new ApiClient(creds), 'http://example.com/api/v1/auth/me')).rejects.toThrow(
      /refuses to send credentials/,
    );
  });

  it('refuses non-HTTP protocols even for loopback hosts', async () => {
    await expect(raw(new ApiClient(creds), 'ftp://localhost/api/v1/auth/me')).rejects.toThrow(
      /refuses to send credentials/,
    );
  });
});

describe('resolveApiBaseUrl (A-013)', () => {
  const base = { WAITLAYER_API_URL: undefined, NODE_ENV: undefined };

  it('defaults to the production origin for a packaged install', () => {
    expect(resolveApiBaseUrl({ ...base })).toBe('https://api.waitlayer.com/api/v1');
  });

  it('honours an explicit WAITLAYER_API_URL override (local dev)', () => {
    expect(resolveApiBaseUrl({ ...base, WAITLAYER_API_URL: 'http://localhost:4002/api/v1' })).toBe(
      'http://localhost:4002/api/v1',
    );
  });

  it('uses the production origin when NODE_ENV=production', () => {
    expect(resolveApiBaseUrl({ ...base, NODE_ENV: 'production' })).toBe(
      'https://api.waitlayer.com/api/v1',
    );
  });

  it('prefers WAITLAYER_API_URL even when NODE_ENV=production', () => {
    expect(
      resolveApiBaseUrl({
        ...base,
        NODE_ENV: 'production',
        WAITLAYER_API_URL: 'http://localhost:4002/api/v1',
      }),
    ).toBe('http://localhost:4002/api/v1');
  });
});
