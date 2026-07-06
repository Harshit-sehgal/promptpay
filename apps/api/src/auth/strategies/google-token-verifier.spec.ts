import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleTokenVerifier } from './google-token-verifier';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

describe('GoogleTokenVerifier', () => {
  let verifier: GoogleTokenVerifier;
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
      UnauthorizedException
    );
  });
});
