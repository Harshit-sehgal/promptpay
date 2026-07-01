import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { SignUpDto, LoginDto, GoogleOAuthDto } from './dto';
import { UserRole, UserStatus } from '@waitlayer/shared';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

interface TokenPayload {
  sub: string;
  role: string;
  family?: string;
}

@Injectable()
export class AuthService {
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly jwtSecret: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private googleVerifier: GoogleTokenVerifier,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    this.jwtSecret = this.config.get<string>('JWT_SECRET')!;
  }

  /** ── Sign Up ── */
  async signUp(dto: SignUpDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
        country: dto.country,
      },
    });

    // Developer onboarding: create settings + trust score
    if (dto.role === UserRole.DEVELOPER) {
      await this.prisma.userSettings.create({ data: { userId: user.id } });
      await this.prisma.trustScore.create({ data: { userId: user.id } });
    }

    // Advertiser onboarding: create advertiser profile stub
    if (dto.role === UserRole.ADVERTISER) {
      await this.prisma.advertiser.create({
        data: { userId: user.id, companyName: dto.name || 'Unnamed Company', billingEmail: dto.email },
      });
    }

    // Handle referral if provided
    if (dto.referrerCode) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referrerCode },
      });
      if (referrer) {
        await this.prisma.referral.create({
          data: {
            referrerId: referrer.id,
            referredId: user.id,
            code: `ref_${user.id.slice(0, 8)}_${Date.now()}`,
          },
        });
      }
    }

    const tokens = await this.generateTokenPair(user.id, user.role);
    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /** ── Login ── */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.passwordHash) {
      throw new UnauthorizedException('Account uses social login — sign in with Google');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.generateTokenPair(user.id, user.role);
    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /** ── Google OAuth ──
   *  Verifies the Google ID token, then:
   *  1. Finds user by googleId → login
   *  2. Finds user by email → link Google account, then login
   *  3. No user → create new account with Google profile info
   */
  async googleOAuth(dto: GoogleOAuthDto) {
    const payload = await this.googleVerifier.verify(dto.idToken);
    if (!payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || undefined;
    const role = dto.role || UserRole.DEVELOPER;

    // 1. Find by googleId
    let user = await this.prisma.user.findUnique({ where: { googleId } });

    if (user) {
      // Existing Google user — just login
      if (user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
        throw new UnauthorizedException('Account is not active');
      }
      const tokens = await this.generateTokenPair(user.id, user.role);
      return { user: this.sanitizeUser(user), ...tokens };
    }

    // 2. Find by email → link Google account
    user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
        throw new UnauthorizedException('Account is not active');
      }
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          googleVerified: true,
          emailVerified: true,
        },
      });
      const tokens = await this.generateTokenPair(user.id, user.role);
      return { user: this.sanitizeUser(user), ...tokens };
    }

    // 3. Create new user
    user = await this.prisma.user.create({
      data: {
        email,
        googleId,
        name,
        role,
        googleVerified: true,
        emailVerified: true,
        // No passwordHash — social login only
      },
    });

    // Developer onboarding: create settings + trust score
    if (role === UserRole.DEVELOPER) {
      await this.prisma.userSettings.create({ data: { userId: user.id } });
      await this.prisma.trustScore.create({ data: { userId: user.id } });
    }

    // Advertiser onboarding: create advertiser profile stub
    if (role === UserRole.ADVERTISER) {
      await this.prisma.advertiser.create({
        data: { userId: user.id, companyName: name || 'Unnamed Company', billingEmail: email },
      });
    }

    const tokens = await this.generateTokenPair(user.id, user.role);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  /** ── Refresh Token Rotation ──
   *  Implements rotation + reuse detection:
   *  - If a refresh token is used twice, the entire token family is revoked
   *  - This prevents token replay attacks
   */
  async refresh(refreshToken: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(refreshToken, {
        secret: this.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Find the session for this token family
    const session = await this.prisma.session.findFirst({
      where: { userId: payload.sub, tokenFamily: payload.family },
    });

    if (!session) {
      // No session found → this is a potential replay. Revoke all sessions.
      await this.revokeAllSessions(payload.sub);
      throw new UnauthorizedException('Session not found — all sessions revoked');
    }

    if (session.revoked) {
      // Token reuse detected! Revoke all sessions for this user
      await this.revokeAllSessions(payload.sub);
      throw new UnauthorizedException('Token reuse detected — all sessions revoked');
    }

    // Mark old session as revoked
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revoked: true },
    });

    // Rotate: issue new token pair
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.generateTokenPair(user.id, user.role, payload.family);
    return tokens;
  }

  /** ── Logout ── */
  async logout(userId: string) {
    await this.revokeAllSessions(userId);
  }

  /** ── Get Current User ── */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        trustLevel: true,
        country: true,
        emailVerified: true,
        googleVerified: true,
        githubVerified: true,
        referralCode: true,
        createdAt: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  // ── Private Helpers ──

  private async generateTokenPair(userId: string, role: string, existingFamily?: string) {
    const family = existingFamily || crypto.randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, role },
        { expiresIn: this.accessTtl as unknown as number },
      ),
      this.jwt.signAsync(
        { sub: userId, role, family },
        { expiresIn: this.refreshTtl as unknown as number },
      ),
    ]);

    // Store session with token family for rotation tracking
    const refreshHash = await bcrypt.hash(refreshToken, 4);
    const expiresAt = new Date(Date.now() + this.parseTtlToMs(this.refreshTtl));

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: refreshHash,
        tokenFamily: family,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId },
      data: { revoked: true },
    });
  }

  private parseTtlToMs(ttl: string): number {
    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30d
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
