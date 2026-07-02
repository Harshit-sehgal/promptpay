import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { UserStatus } from '@waitlayer/shared';

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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
    if (!user || user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('User is not active');
    }
    return user;
  }
}
