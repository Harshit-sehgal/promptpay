import { type Request } from 'express';
import { ExtractJwt, JwtFromRequestFunction, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { isActiveAccountStatus } from '../../common/utils/account-status';
import { PrismaService } from '../../config/prisma.service';
import { audienceIncludes } from '../auth.constants';

/**
 * Dual-source JWT extraction: Authorization header OR httpOnly `access_token`
 * cookie. The web app sets `access_token` as an HttpOnly cookie via its
 * Next.js Route Handlers (cookie-based auth that defeats XSS exfiltration);
 * the CLI/VSCode-extension clients send a Bearer token in the Authorization
 * header as usual. Both paths produce the same access JWT.
 */
function extractJwtFromRequest(req: Request): string | null {
  // 1. Authorization: Bearer <token> (CLI / VSCode / external integrations)
  const headerToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (headerToken) return headerToken;

  // 2. HttpOnly access_token cookie (Next.js web app). Prefer the host-bound
  //    `__Host-` form (Secure + Path=/, no Domain) and only fall back to the
  //    bare name as a dev/HTTP compatibility shim.
  const cookieToken = req.cookies?.['__Host-access_token'] ?? req.cookies?.access_token;
  if (cookieToken) return cookieToken;
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const publicKey = config.get<string>('JWT_PUBLIC_KEY');
    if (!publicKey) {
      throw new Error(
        'JWT_PUBLIC_KEY must be defined for RS256 token verification. Set the public key in your environment.',
      );
    }
    super({
      jwtFromRequest: extractJwtFromRequest as JwtFromRequestFunction,
      ignoreExpiration: false,
      secretOrKey: publicKey,
      algorithms: ['RS256'],
      issuer: config.get<string>('JWT_ISSUER', 'waitlayer'),
      audience: config.get<string>('JWT_AUDIENCE', 'waitlayer-client'),
    });
  }

  async validate(payload: {
    sub: string;
    role: string;
    jti: string;
    aud?: string | string[];
    mfaAt?: number;
  }) {
    if (!audienceIncludes(payload.aud, 'access')) {
      throw new UnauthorizedException('Invalid token audience');
    }
    if (!payload.jti) {
      throw new UnauthorizedException('Invalid token signature');
    }

    // Instantly reject access tokens if the session is revoked (logout/rotation reuse)
    const session = await this.prisma.session.findUnique({
      where: { id: payload.jti },
    });
    if (!session || session.revoked) {
      throw new UnauthorizedException('Session is revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        trustLevel: true,
        twoFactorEnabled: true,
      },
    });
    if (!user || !isActiveAccountStatus(user.status)) {
      throw new UnauthorizedException('User is not active');
    }
    return { ...user, jti: payload.jti, mfaAt: payload.mfaAt };
  }
}
