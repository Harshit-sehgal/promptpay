import { describe, expect, it } from 'vitest';
import { ApiClient } from './api-client';
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
