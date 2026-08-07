import { OAuth2Client } from 'google-auth-library';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Google ID Token verification service.
 *
 * Verifies Google ID tokens with Google's supported server-side library. The
 * library verifies the signature against Google's cached signing keys and
 * enforces the audience, issuer, and expiry claims locally. Google's tokeninfo
 * endpoint is a debugging aid and must not be an authentication dependency.
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
  iat: number;
  exp: number;
}

@Injectable()
export class GoogleTokenVerifier {
  private readonly clientId: string;
  private readonly enabled: boolean;
  private readonly googleClient: OAuth2Client;

  constructor(private config: ConfigService) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID', '')!;
    this.enabled = !!this.clientId;
    this.googleClient = new OAuth2Client({
      clientId: this.clientId || undefined,
      transporterOptions: {
        timeout: this.config.get<number>('GOOGLE_AUTH_TIMEOUT_MS', 5_000),
      },
    });
  }

  /** Verify a Google ID token and return the decoded payload */
  async verify(idToken: string): Promise<GoogleIdTokenPayload> {
    // Mock path is intentionally narrow: requires BOTH NODE_ENV not 'production'
    // AND an explicit opt-in env flag. A deploy that omits the flag (or sets it
    // to anything other than '1') cannot mock — even with NODE_ENV=development.
    // This prevents staging/preview/qa environments from silently accepting
    // mock-google-token-* identities.
    const mockEnabled =
      (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
      (process.env.MOCK_GOOGLE_ENABLED === '1' || process.env.ALLOW_MOCK_GOOGLE === 'true'); // legacy compat
    const isMockToken = idToken.startsWith('mock-google-token-');
    if (isMockToken && !mockEnabled) {
      throw new UnauthorizedException(
        'Mock Google tokens are only allowed in local development or test environments',
      );
    }

    if (isMockToken && mockEnabled) {
      const parts = idToken.split('-');
      const identifier = parts[3] || 'user';
      const email = `${identifier}@mock-google.com`;
      const name =
        parts
          .slice(3)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' ') || 'Mock User';
      const sub = `mock-google-sub-${identifier}`;
      return {
        sub,
        email,
        email_verified: true,
        name,
        picture: 'https://lh3.googleusercontent.com/a/default-user',
        aud: this.clientId || 'mock-client-id',
        iss: 'accounts.google.com',
        iat: Math.floor(Date.now() / 1_000),
        exp: Math.floor(Date.now() / 1_000) + 3_600,
      };
    }

    if (!this.enabled) {
      throw new UnauthorizedException('Google Sign-In is not configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch {
      // Deliberately do not expose whether verification failed because of a bad
      // signature/claim or an upstream key-refresh failure.
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload || typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      (payload.iat ?? 0) <= 0 ||
      (payload.exp ?? 0) <= 0
    ) {
      throw new UnauthorizedException('Google token contains invalid time claims');
    }

    if (
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      !payload.email.includes('@')
    ) {
      throw new UnauthorizedException('Google token contains an invalid email');
    }

    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    // Verify the token was issued for our app
    if (payload.aud !== this.clientId) {
      throw new UnauthorizedException('Google token audience mismatch');
    }

    // Verify issuer
    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
      throw new UnauthorizedException('Invalid Google token issuer');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: true,
      name: payload.name,
      picture: payload.picture,
      aud: payload.aud,
      iss: payload.iss,
      iat: payload.iat,
      exp: payload.exp,
    };
  }

  /**
   * Verify a Google token used as a fresh reauthentication proof. A valid ID
   * token can otherwise be close to an hour old, which is too weak for account
   * deletion, MFA enrollment, credential linking, or device recovery.
   */
  async verifyRecent(idToken: string, maxAgeSeconds = 300): Promise<GoogleIdTokenPayload> {
    const payload = await this.verify(idToken);
    const now = Math.floor(Date.now() / 1_000);
    const age = now - payload.iat;
    if (maxAgeSeconds <= 0 || age < -60 || age > maxAgeSeconds) {
      throw new UnauthorizedException('Fresh Google reauthentication is required');
    }
    return payload;
  }
}
