import { LoginTicket, OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GoogleTokenVerifier } from './google-token-verifier';

describe('GoogleTokenVerifier', () => {
  let verifier: GoogleTokenVerifier;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowMockGoogle = process.env.ALLOW_MOCK_GOOGLE;
  const originalMockGoogleEnabled = process.env.MOCK_GOOGLE_ENABLED;
  const mockConfig = {
    get: vi.fn((key: string, fallback?: string) => {
      if (key === 'GOOGLE_CLIENT_ID') return 'real-client-id';
      return fallback ?? null;
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    verifier = new GoogleTokenVerifier(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowMockGoogle === undefined) delete process.env.ALLOW_MOCK_GOOGLE;
    else process.env.ALLOW_MOCK_GOOGLE = originalAllowMockGoogle;
    if (originalMockGoogleEnabled === undefined) delete process.env.MOCK_GOOGLE_ENABLED;
    else process.env.MOCK_GOOGLE_ENABLED = originalMockGoogleEnabled;
  });

  it('should verify mock tokens in non-production environments with flag set', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_MOCK_GOOGLE = 'true';
    const payload = await verifier.verify('mock-google-token-john-doe');

    expect(payload.email).toBe('john@mock-google.com');
    expect(payload.name).toBe('John Doe');
    expect(payload.email_verified).toBe(true);
    expect(payload.sub).toBe('mock-google-sub-john');
    expect(payload.iss).toBe('accounts.google.com');
  });

  it('should throw UnauthorizedException for mock tokens in production environment', async () => {
    process.env.NODE_ENV = 'production';

    await expect(verifier.verify('mock-google-token-john-doe')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if not configured and not a mock token', async () => {
    const unconfiguredConfig = {
      get: vi.fn().mockReturnValue(''),
    } as unknown as ConfigService;
    const unconfiguredVerifier = new GoogleTokenVerifier(unconfiguredConfig);

    await expect(unconfiguredVerifier.verify('real-token-abc')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('verifies a production token with the supported Google library and expected audience', async () => {
    process.env.NODE_ENV = 'production';
    const verifyIdToken = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-subject',
        email: 'person@example.com',
        email_verified: true,
        name: 'Example Person',
        picture: 'https://example.com/avatar.png',
        aud: 'real-client-id',
        iss: 'https://accounts.google.com',
        iat: 1_700_000_000,
        exp: 1_700_003_600,
      }),
    } as LoginTicket);

    await expect(verifier.verify('signed-google-id-token')).resolves.toEqual({
      sub: 'google-subject',
      email: 'person@example.com',
      email_verified: true,
      name: 'Example Person',
      picture: 'https://example.com/avatar.png',
      aud: 'real-client-id',
      iss: 'https://accounts.google.com',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',
      audience: 'real-client-id',
    });
  });

  it('fails closed when Google signature or claim verification rejects the token', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(
      new Error('invalid signature'),
    );

    await expect(verifier.verify('forged-token')).rejects.toThrow('Invalid Google ID token');
  });

  it('rejects a verified token whose email is not verified', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-subject',
        email: 'person@example.com',
        email_verified: false,
        aud: 'real-client-id',
        iss: 'accounts.google.com',
        iat: 1_700_000_000,
        exp: 1_700_003_600,
      }),
    } as LoginTicket);

    await expect(verifier.verify('unverified-email-token')).rejects.toThrow(
      'Google account email is not verified',
    );
  });

  it('rejects malformed identity claims even after cryptographic verification', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: '',
        email: 'not-an-email',
        email_verified: true,
        aud: 'real-client-id',
        iss: 'accounts.google.com',
        iat: 1_700_000_000,
        exp: 1_700_003_600,
      }),
    } as LoginTicket);

    await expect(verifier.verify('malformed-token')).rejects.toThrow('Invalid Google ID token');
  });

  it('accepts only a recently issued token for sensitive reauthentication', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_300_000);
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-subject',
        email: 'person@example.com',
        email_verified: true,
        aud: 'real-client-id',
        iss: 'accounts.google.com',
        iat: 1_700_000_001,
        exp: 1_700_003_600,
      }),
    } as LoginTicket);

    await expect(verifier.verifyRecent('fresh-token')).resolves.toMatchObject({
      sub: 'google-subject',
      iat: 1_700_000_001,
    });
  });

  it.each([
    ['stale', 1_699_999_999],
    ['implausibly future-dated', 1_700_000_361],
  ])('rejects a %s Google token as reauthentication proof', async (_label, issuedAt) => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_300_000);
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-subject',
        email: 'person@example.com',
        email_verified: true,
        aud: 'real-client-id',
        iss: 'accounts.google.com',
        iat: issuedAt,
        exp: 1_700_003_600,
      }),
    } as LoginTicket);

    await expect(verifier.verifyRecent('old-token')).rejects.toThrow(
      'Fresh Google reauthentication is required',
    );
  });
});
