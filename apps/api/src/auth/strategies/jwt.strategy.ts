import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, JwtFromRequestFunction } from 'passport-jwt';
import { type Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { isActiveAccountStatus } from '../../common/utils/account-status';

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

  // 2. HttpOnly access_token cookie (Next.js web app)
  if (req.cookies?.access_token) return req.cookies.access_token;

  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be defined and at least 32 characters. Set a strong secret in your environment.',
      );
    }
    super({
      jwtFromRequest: extractJwtFromRequest as JwtFromRequestFunction,
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; role: string; jti: string; aud?: string }) {
    if (payload.aud !== 'access') {
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
      select: { id: true, email: true, role: true, status: true, trustLevel: true },
    });
    if (!user || !isActiveAccountStatus(user.status)) {
      throw new UnauthorizedException('User is not active');
    }
    return user;
  }
}
