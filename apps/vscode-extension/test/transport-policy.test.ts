import { describe, expect, it } from 'vitest';
import { requestHostnameForUrl, resolveCredentialSafeUrl } from '../src/transport-policy';

describe('VS Code extension transport policy', () => {
  it('allows remote HTTPS API endpoints', () => {
    const url = resolveCredentialSafeUrl('https://api.example.com/api/v1', '/auth/me');

    expect(url.toString()).toBe('https://api.example.com/api/v1/auth/me');
  });

  it('allows loopback HTTP for local development', () => {
    expect(resolveCredentialSafeUrl('http://localhost:4002/api/v1', '/auth/me').hostname).toBe(
      'localhost',
    );
    expect(resolveCredentialSafeUrl('http://127.0.0.1:4002/api/v1', '/auth/me').hostname).toBe(
      '127.0.0.1',
    );

    const ipv6 = resolveCredentialSafeUrl('http://[::1]:4002/api/v1', '/auth/me');
    expect(requestHostnameForUrl(ipv6)).toBe('::1');
  });

  it('rejects cleartext remote API endpoints before sending credentials', () => {
    expect(() => resolveCredentialSafeUrl('http://api.example.com/api/v1', '/auth/me')).toThrow(
      /refuses to send credentials/,
    );
  });

  it('rejects non-HTTP protocols even for loopback hosts', () => {
    expect(() => resolveCredentialSafeUrl('ftp://localhost/api/v1', '/auth/me')).toThrow(
      /refuses to send credentials/,
    );
  });
});
