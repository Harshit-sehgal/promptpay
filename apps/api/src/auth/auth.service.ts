import { randomBytes, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { SignUpDto, LoginDto, GoogleOAuthDto } from './dto';
import { UserRole, UserStatus } from '@waitlayer/shared';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { FraudService } from '../fraud/fraud.service';

interface TokenPayload {
  sub: string;
  role: string;
  family?: string;
  jti?: string;
  aud?: string;
}

interface AccessTokenPayload {
  sub: string;
  role: string;
  jti: string;
  aud: string;
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
    private fraud: FraudService,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be defined and at least 32 characters. Set a strong secret in your environment (e.g. `openssl rand -base64 48`).',
      );
    }
    this.jwtSecret = secret;
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

    // Generate referral code for the new user
    const referralCode = await this.generateReferralCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { referralCode },
    });
    user.referralCode = referralCode;

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

    // Generate referral code for the new user
    const referralCode = await this.generateReferralCode();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { referralCode },
    });
    user.referralCode = referralCode;

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

    if (payload.aud !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    // Find the session for this specific token
    const session = await this.prisma.session.findUnique({
      where: { id: payload.jti },
    });

    if (!session) {
      // Replay attack / forged token. Revoke all sessions in the family if family ID is known
      if (payload.family) {
        await this.prisma.session.updateMany({
          where: { userId: payload.sub, tokenFamily: payload.family },
          data: { revoked: true },
        });
      } else {
        await this.revokeAllSessions(payload.sub);
      }
      throw new UnauthorizedException('Session not found — all sessions revoked');
    }

    if (session.revoked) {
      // Reuse detected! Revoke all sessions for this token family
      await this.prisma.session.updateMany({
        where: { userId: payload.sub, tokenFamily: session.tokenFamily },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Token reuse detected — family sessions revoked');
    }

    // Verify token hash
    const isMatch = await bcrypt.compare(refreshToken, session.tokenHash);
    if (!isMatch) {
      await this.prisma.session.updateMany({
        where: { userId: payload.sub, tokenFamily: session.tokenFamily },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Token hash mismatch — family sessions revoked');
    }

    // Revoke the old session
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revoked: true },
    });

    // Rotate: issue new token pair
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account is not active');
    }

    return this.generateTokenPair(user.id, user.role, session.tokenFamily || undefined);
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

  getGoogleClientId() {
    return this.config.get<string>('GOOGLE_CLIENT_ID', '');
  }

  // ── Private Helpers ──

  private async generateTokenPair(userId: string, role: string, existingFamily?: string) {
    const family = existingFamily || randomUUID();
    // Pre-generate a session ID to use as jti in the access token
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, role, jti, aud: 'access' } satisfies AccessTokenPayload & { aud: string },
        { expiresIn: this.accessTtl as unknown as number },
      ),
      this.jwt.signAsync(
        { sub: userId, role, family, jti, aud: 'refresh' },
        { expiresIn: this.refreshTtl as unknown as number },
      ),
    ]);

    // Store session with token family for rotation tracking
    const refreshHash = await bcrypt.hash(refreshToken, 4);
    const expiresAt = new Date(Date.now() + this.parseTtlToMs(this.refreshTtl));

    await this.prisma.session.create({
      data: {
        id: jti,
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

  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Stateless token: contains userId, email, and action. Valid for 24 hours.
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email, action: 'email-verification' },
      { secret: this.jwtSecret, expiresIn: '24h' },
    );

    console.log(`[Email Verification] Verification token requested for ${user.email}. Token: ${token}`);
    return {
      message: 'Verification token generated successfully',
      token,
    };
  }

  async confirmEmailVerification(token: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.jwtSecret });
    } catch (err) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (payload.action !== 'email-verification') {
      throw new BadRequestException('Invalid token action');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerified) {
      return { message: 'Email is already verified', email: user.email };
    }

    // Update user to verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // Recompute trust score to account for email verification (+10 points)
    await this.fraud.computeTrustScore(user.id);

    return {
      message: 'Email verified successfully',
      email: user.email,
    };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  /** Generate a unique 8-char alphanumeric referral code (uppercase + digits) */
  private async generateReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 8;

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from(randomBytes(length))
        .map((b) => chars[b % chars.length])
        .join('');

      const exists = await this.prisma.user.findUnique({
        where: { referralCode: code },
      });
      if (!exists) return code;
    }

    // Fallback: append random suffix to avoid infinite loop
    const base = Array.from(randomBytes(6))
      .map((b) => chars[b % chars.length])
      .join('');
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    return `${base}${suffix}`;
  }
}
