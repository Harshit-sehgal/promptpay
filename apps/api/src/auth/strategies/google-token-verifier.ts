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
