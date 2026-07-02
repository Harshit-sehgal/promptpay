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

  it('should verify mock tokens in non-production environments', async () => {
    process.env.NODE_ENV = 'development';
    const payload = await verifier.verify('mock-google-token-john-doe');
    
    expect(payload.email).toBe('john@mock-google.com');
    expect(payload.name).toBe('John Doe');
    expect(payload.email_verified).toBe(true);
    expect(payload.sub).toBe('mock-google-sub-john');
    expect(payload.iss).toBe('accounts.google.com');
  });

  it('should throw UnauthorizedException for mock tokens in production environment', async () => {
    process.env.NODE_ENV = 'production';
    
    // In production, mock tokens are not bypassed, they are sent to the Google endpoint
    // which will fail or throw standard exceptions
    await expect(verifier.verify('mock-google-token-john-doe')).rejects.toThrow();
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
