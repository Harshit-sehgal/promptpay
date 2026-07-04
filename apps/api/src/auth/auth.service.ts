import { createHash, randomBytes, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../config/prisma.service';
import { SignUpDto, LoginDto, GoogleOAuthDto } from './dto';
import { UserRole, UserStatus, DEFAULT_COMPANY_NAME } from '@waitlayer/shared';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { FraudService } from '../fraud/fraud.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';

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

interface EmailVerificationPayload {
  sub: string;
  email: string;
  action: string;
}

interface PasswordResetPayload {
  sub: string;
  action: string;
  /** Fingerprint of the password hash at issue time — invalidates the token once the password changes */
  fp: string;
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
    private email: EmailService,
    private audit: AuditService,
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
        data: { userId: user.id, companyName: dto.name || DEFAULT_COMPANY_NAME, billingEmail: dto.email },
      });
    }

    // Handle referral if provided
    if (dto.referrerCode) {
      const normalizedReferrerCode = dto.referrerCode.trim().toUpperCase();
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: normalizedReferrerCode },
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

    // Audit log: new user registration
    this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'signup',
      targetType: 'user',
      targetId: user.id,
      afterSnap: { email: user.email, role: user.role },
    }).catch(() => {});

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /** ── Login ── */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      // Audit: login attempt for unknown email
      this.audit.log({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'login_failed',
        targetType: 'user',
        targetId: dto.email,
        afterSnap: { reason: 'unknown_email' },
      }).catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── Order matters: check account status BEFORE running the
    // bcrypt.compare, so a banned/deleted account's password is never
    // disclosed via the "Account is not active" oracle that previously
    // fired only after a successful compare. ──
    if (user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      // Always throw the same generic message to avoid status enumeration.
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Account uses social login — sign in with Google');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      // Audit: failed password attempt
      this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: 'bad_password' },
      }).catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
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

    // 2. Find by email — REFUSE silent email-link to prevent account takeover.
    //    If an attacker registers a Google account with a victim's email and
    //    presents its ID token, linking by email alone would silently grant
    //    them tokens for the victim's pre-existing password account. The
    //    user must explicitly link Google from inside the existing account
    //    (see /auth/link/google) after proving ownership via password or a
    //    fresh signed email-link request.
    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      // Audit the attempted takeover so the real owner can detect it.
      this.audit.log({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'google_link_blocked_existing_email',
        targetType: 'user',
        targetId: existingByEmail.id,
        afterSnap: { email, googleSub: googleId },
      }).catch(() => {});
      throw new ConflictException(
        'An account with this email already exists. Sign in with your password and link Google from your account settings.',
      );
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
        data: { userId: user.id, companyName: name || DEFAULT_COMPANY_NAME, billingEmail: email },
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

    // ── Atomic refresh rotation with concurrency hardening ──
    // 1) Revoke the old session via a conditional UPDATE keyed on
    //    `revoked = false`. This is the DB-level CAS: if two concurrent
    //    refreshes land, exactly one wins (count === 1).
    // 2) Only AFTER the old session is atomically revoked do we re-verify
    //    the token hash and load the user. If the CAS fails, another
    //    refresh won the race — invalidate the whole token family.
    const revokeResult = await this.prisma.session.updateMany({
      where: { id: payload.jti, revoked: false },
      data: { revoked: true },
    });

    if (revokeResult.count === 0) {
      // Lost the race OR a prior refresh already revoked this session.
      // Load the session to learn its family, then revoke everything in it.
      const racedSession = await this.prisma.session.findUnique({
        where: { id: payload.jti },
        select: { tokenFamily: true, revoked: true },
      });
      if (payload.family || racedSession?.tokenFamily) {
        await this.prisma.session.updateMany({
          where: {
            userId: payload.sub,
            tokenFamily: racedSession?.tokenFamily ?? payload.family!,
          },
          data: { revoked: true },
        });
      } else {
        await this.revokeAllSessions(payload.sub);
      }
      throw new UnauthorizedException('Token reuse detected — family sessions revoked');
    }

    // CAS succeeded — now load the session to verify the token hash and
    // get the family. If the row was deleted between updateMany and this
    // read, treat as forged token.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.jti },
    });
    if (!session) {
      // Should not happen since we just successfully revoked it. Be safe.
      throw new UnauthorizedException('Session not found');
    }

    // Verify token hash. A mismatch means the JWT was tampered or belongs
    // to a different family — invalidate the family.
    const isMatch = await bcrypt.compare(refreshToken, session.tokenHash);
    if (!isMatch) {
      await this.prisma.session.updateMany({
        where: { userId: payload.sub, tokenFamily: session.tokenFamily },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Token hash mismatch — family sessions revoked');
    }

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
    // Log who logged out (requires fetching role — fetch user briefly here)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    this.audit.log({
      actorId: userId,
      actorRole: user?.role ?? 'unknown',
      action: 'logout',
      targetType: 'session',
      targetId: userId,
    }).catch(() => {});
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

    await this.email.sendEmailVerification(user.email, token);

    // Fail-closed: expose the raw token only when explicitly in dev/test.
    // Anything other than 'development' | 'test' (including unset, 'staging',
    // 'production') returns a generic success only — never the token.
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const expose = nodeEnv === 'development' || nodeEnv === 'test';
    return {
      message: 'Verification email sent',
      ...(expose ? { token } : {}),
    };
  }

  async confirmEmailVerification(token: string) {
    let payload: EmailVerificationPayload;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.jwtSecret });
    } catch {
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

  /** ── Password Reset: Request ──
   *  Always returns a generic message to prevent account enumeration.
   *  The stateless token embeds a fingerprint of the current password hash,
   *  so it self-invalidates as soon as the password changes (single-use).
   */
  async requestPasswordReset(email: string) {
    const generic = {
      message: 'If an account exists for that email, a password reset link has been sent',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      return generic;
    }

    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        action: 'password-reset',
        fp: this.passwordFingerprint(user.passwordHash),
      },
      { secret: this.jwtSecret, expiresIn: '1h' },
    );

    await this.email.sendPasswordReset(user.email, token);

    // Fail-closed: expose the raw token only when explicitly in dev/test.
    // The reset token grants full account takeover — it must NEVER leak in
    // any staging/preview/production environment.
    const nodeEnv = this.config.get<string>('NODE_ENV');
    const expose = nodeEnv === 'development' || nodeEnv === 'test';
    return { ...generic, ...(expose ? { token } : {}) };
  }

  /** ── Password Reset: Confirm ──
   *  Verifies the token, checks the password-hash fingerprint (single-use),
   *  sets the new password, and revokes ALL sessions.
   */
  async resetPassword(token: string, newPassword: string) {
    let payload: PasswordResetPayload;
    try {
      payload = await this.jwt.verifyAsync<PasswordResetPayload>(token, { secret: this.jwtSecret });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (payload.action !== 'password-reset' || !payload.fp) {
      throw new BadRequestException('Invalid token action');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new BadRequestException('Invalid or expired reset token');

    if (user.status === UserStatus.BANNED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedException('Account is not active');
    }

    // Single-use: if the password changed since the token was issued, reject
    if (this.passwordFingerprint(user.passwordHash) !== payload.fp) {
      throw new BadRequestException('Reset token is no longer valid');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Security: sign out everywhere after a password change
    await this.revokeAllSessions(user.id);

    // Best-effort notification — never fail the reset because of email delivery
    void this.email.sendPasswordChanged(user.email).catch(() => undefined);

    // Audit log: password reset completed
    this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'password_reset',
      targetType: 'user',
      targetId: user.id,
    }).catch(() => {});

    return { message: 'Password reset successfully. Please sign in with your new password.' };
  }

  /** Stable fingerprint of the current password hash (or its absence) */
  private passwordFingerprint(passwordHash: string | null): string {
    return createHash('sha256')
      .update(passwordHash ?? 'no-password')
      .digest('hex')
      .slice(0, 16);
  }

  private sanitizeUser<T extends { passwordHash?: unknown }>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _passwordHash, ...safe } = user;
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
