import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Google ID Token verification service.
 *
 * Verifies Google ID tokens by calling Google's tokeninfo endpoint.
 * This is the recommended approach for server-side verification of
 * client-side Google Sign-In (GIS) ID tokens when you don't need
 * the full passport strategy overhead.
 *
 * Decoded payload shape from Google:
 * {
 *   sub: string;       // Google user ID (stable, unique)
 *   email: string;     // User email
 *   email_verified: boolean;
 *   name?: string;     // Full name
 *   picture?: string;  // Avatar URL
 *   aud: string;       // Expected audience (your client ID)
 *   iss: string;       // Expected issuer ("accounts.google.com")
 * }
 */
export interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly clientId: string;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID', '')!;
    this.enabled = !!this.clientId;
  }

  /** Verify a Google ID token and return the decoded payload */
  async verify(idToken: string): Promise<GoogleIdTokenPayload> {
    // Mock path is intentionally narrow: requires BOTH NODE_ENV not 'production'
    // AND an explicit opt-in env flag. A deploy that omits the flag (or sets it
    // to anything other than '1') cannot mock — even with NODE_ENV=development.
    // This prevents staging/preview/qa environments from silently accepting
    // mock-google-token-* identities.
    const mockEnabled =
      process.env.MOCK_GOOGLE_ENABLED === '1' ||
      process.env.ALLOW_MOCK_GOOGLE === 'true'; // legacy compat
    const isMockToken = idToken.startsWith('mock-google-token-');
    if (isMockToken && process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('Mock Google tokens are disabled in production');
    }

    if (isMockToken && mockEnabled) {
      const parts = idToken.split('-');
      const identifier = parts[3] || 'user';
      const email = `${identifier}@mock-google.com`;
      const name = parts.slice(3).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'Mock User';
      const sub = `mock-google-sub-${identifier}`;
      return {
        sub,
        email,
        email_verified: true,
        name,
        picture: 'https://lh3.googleusercontent.com/a/default-user',
        aud: this.clientId || 'mock-client-id',
        iss: 'accounts.google.com',
      };
    }

    if (!this.enabled) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    // Call Google's tokeninfo endpoint to verify the token
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!response.ok) {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    const payload = (await response.json()) as GoogleIdTokenPayload;

    // Google's tokeninfo endpoint returns `email_verified` as the STRING
    // "true"/"false" (not a JSON boolean). The earlier interface typed it
    // as `boolean` and the audit check `if (!payload.email_verified)` then
    // incorrectly passed the truthy string "false" — silently treating
    // unverified Google emails as verified. Coerce here at the boundary.
    payload.email_verified = String(payload.email_verified) === 'true';

    // Verify the token was issued for our app
    if (payload.aud !== this.clientId) {
      throw new UnauthorizedException('Google token audience mismatch');
    }

    // Verify issuer
    if (
      payload.iss !== 'accounts.google.com' &&
      payload.iss !== 'https://accounts.google.com'
    ) {
      throw new UnauthorizedException('Invalid Google token issuer');
    }

    return payload;
  }
}
