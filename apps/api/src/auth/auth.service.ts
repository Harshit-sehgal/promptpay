import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
// `@types/jsonwebtoken` types `expiresIn` as `ms`'s branded `StringValue`,
// not a bare `string`. ConfigService hands us plain strings, so we brand
// them at assignment time so the value satisfies the option type.
import type { StringValue } from 'ms';
import { PrismaService } from '../config/prisma.service';
import { Prisma } from '@waitlayer/db';
import { SignUpDto, LoginDto, GoogleOAuthDto } from './dto';
import { UserRole, DEFAULT_COMPANY_NAME, generateTotpSecret, buildOtpAuthUrl, verifyTotp } from '@waitlayer/shared';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { FraudService } from '../fraud/fraud.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';

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
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtl: StringValue;
  private readonly refreshTtl: StringValue;
  private readonly jwtSecret: string;
  private readonly totpEncryptionKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private googleVerifier: GoogleTokenVerifier,
    private fraud: FraudService,
    private email: EmailService,
    private audit: AuditService,
  ) {
    // Brand the config strings as `StringValue` so they satisfy jsonwebtoken's
    // `expiresIn` type. The defaults ('15m', '30d') and any runtime
    // JWT_*_TTL override are valid `ms` duration strings; an invalid value
    // would fail at sign time, not typecheck.
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m') as StringValue;
    this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d') as StringValue;
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be defined and at least 32 characters. Set a strong secret in your environment (e.g. `openssl rand -base64 48`).',
      );
    }
    this.jwtSecret = secret;
    this.totpEncryptionKey = this.buildTotpEncryptionKey();
  }

  /** ── Sign Up ── */
  async signUp(dto: SignUpDto) {
    // Optimistic pre-check: catch sequential duplicate signups with a cheap
    // read before paying the bcrypt.hash cost on a doomed insert. Concurrent
    // signups race past this check; the P2002 catch below translates the
    // unique-constraint failure into the same ConflictException so the
    // loser always sees a clean 409 instead of a 500.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const referralCode = await this.generateReferralCode();

    const user = await this.prisma.$transaction(async (tx) => {
      let createdUser;
      try {
        createdUser = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            name: dto.name,
            role: dto.role,
            country: dto.country,
            referralCode,
          },
        });
      } catch (err: unknown) {
        // Concurrent signups with the same email race past the pre-check
        // above. The `email @unique` constraint is THE authoritative source of
        // truth — translate P2002 into ConflictException so the loser doesn't
        // see a raw Prisma error (500) leak past the API surface.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Email already registered');
        }
        throw err;
      }

      // Developer onboarding: create settings + trust score
      if (dto.role === UserRole.DEVELOPER) {
        await tx.userSettings.create({ data: { userId: createdUser.id } });
        await tx.trustScore.create({ data: { userId: createdUser.id } });
      }

      // Advertiser onboarding: create advertiser profile stub
      if (dto.role === UserRole.ADVERTISER) {
        await tx.advertiser.create({
          data: { userId: createdUser.id, companyName: dto.name || DEFAULT_COMPANY_NAME, billingEmail: dto.email },
        });
      }

      // Handle referral if provided
      if (dto.referrerCode) {
        const normalizedReferrerCode = dto.referrerCode.trim().toUpperCase();
        const referrer = await tx.user.findUnique({
          where: { referralCode: normalizedReferrerCode },
        });
        if (referrer) {
          await tx.referral.create({
            data: {
              referrerId: referrer.id,
              referredId: createdUser.id,
              code: `ref_${createdUser.id.slice(0, 8)}_${Date.now()}`,
            },
          });
        }
      }

      return createdUser;
    });

    const tokens = await this.generateTokenPair(user.id, user.role);

    // Audit log: new user registration (fire-and-forget)
    void this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'signup',
      targetType: 'user',
      targetId: user.id,
      afterSnap: { email: user.email, role: user.role },
    });

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
      void this.audit.log({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'login_failed',
        targetType: 'user',
        targetId: dto.email,
        afterSnap: { reason: 'unknown_email' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // ── Order matters: check account status BEFORE running the
    // bcrypt.compare, so a banned/deleted account's password is never
    // disclosed via the "Account is not active" oracle that previously
    // fired only after a successful compare. ──
    if (!isActiveAccountStatus(user.status)) {
      // Always throw the same generic message to avoid status enumeration.
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      // Do not disclose that the account exists but uses social login.
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      // Audit: failed password attempt
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: 'bad_password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    this.assertTwoFactorSatisfied(user, dto.twoFactorToken);

    const tokens = await this.generateTokenPair(user.id, user.role);

    // Audit: successful login
    void this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'login_success',
      targetType: 'user',
      targetId: user.id,
    });

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
      if (!isActiveAccountStatus(user.status)) {
        throw new UnauthorizedException('Invalid credentials');
      }
      this.assertTwoFactorSatisfied(user, dto.twoFactorToken);
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
      void this.audit.log({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'google_link_blocked_existing_email',
        targetType: 'user',
        targetId: existingByEmail.id,
        afterSnap: { email, googleSub: googleId },
      });
      throw new ConflictException(
        'An account with this email already exists. Sign in with your password and link Google from your account settings.',
      );
    }

    // 3. Create new user + companion records atomically. Mirror the
    // transactional `signUp` path so a failure mid-onboarding cannot leave an
    // orphaned user without its settings / trust score / advertiser profile.
    const referralCode = await this.generateReferralCode();
    user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          googleId,
          name,
          role,
          googleVerified: true,
          emailVerified: true,
          referralCode,
          // No passwordHash — social login only
        },
      });

      // Developer onboarding: create settings + trust score
      if (role === UserRole.DEVELOPER) {
        await tx.userSettings.create({ data: { userId: createdUser.id } });
        await tx.trustScore.create({ data: { userId: createdUser.id } });
      }

      // Advertiser onboarding: create advertiser profile stub
      if (role === UserRole.ADVERTISER) {
        await tx.advertiser.create({
          data: { userId: createdUser.id, companyName: name || DEFAULT_COMPANY_NAME, billingEmail: email },
        });
      }

      return createdUser;
    });

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
      // Forensic trail: a refresh-token replay is the canonical theft
      // signal reuse-detection exists to surface. Audit it so ops can
      // query `action='refresh_reuse_detected'` for incident response.
      void this.audit.log({
        actorId: payload.sub,
        actorRole: 'unknown',
        action: 'refresh_reuse_detected',
        targetType: 'session',
        targetId: payload.jti,
        afterSnap: {
          reason: 'cas_lost',
          family: racedSession?.tokenFamily ?? payload.family ?? null,
        },
      });
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
      // Hash mismatch = a tampered JWT or a token from a different family
      // (theft / forgery attempt). Audit so the family-revoke is visible.
      void this.audit.log({
        actorId: payload.sub,
        actorRole: 'unknown',
        action: 'refresh_reuse_detected',
        targetType: 'session',
        targetId: payload.jti,
        afterSnap: {
          reason: 'hash_mismatch',
          family: session.tokenFamily,
        },
      });
      throw new UnauthorizedException('Token hash mismatch — family sessions revoked');
    }

    // Rotate: issue new token pair
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !isActiveAccountStatus(user.status)) {
      throw new UnauthorizedException('Account is not active');
    }

    return this.generateTokenPair(user.id, user.role, session.tokenFamily || undefined);
  }

  /** ── Logout ── */
  async logout(userId: string, jti?: string) {
    if (jti) {
      await this.prisma.session.updateMany({
        where: { id: jti, userId },
        data: { revoked: true },
      });
    } else {
      await this.revokeAllSessions(userId);
    }
    // Log who logged out (requires fetching role — fetch user briefly here)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    void this.audit.log({
      actorId: userId,
      actorRole: user?.role ?? 'unknown',
      action: 'logout',
      targetType: 'session',
      targetId: userId,
    });
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
        { expiresIn: this.accessTtl },
      ),
      this.jwt.signAsync(
        { sub: userId, role, family, jti, aud: 'refresh' },
        { expiresIn: this.refreshTtl },
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

    const result = await this.email.sendEmailVerification(user.email, token);
    if (!result.delivered) {
      // Email provider is down — don't tell the user the message was sent.
      // Ops can match audit.log entries to provider outages. The token is
      // valid for 24h; the user can retry when the provider recovers.
      return { message: 'Email delivery temporarily unavailable; please try again shortly' };
    }

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

    // Bind the token to the user's CURRENT email. Tokens are minted
    // with `email: user.email` at request time. If the account's email
    // ever changes between request and confirm, the stale token must
    // NOT verify the new email — otherwise an attacker who intercepts
    // (or replays) an outstanding token could silently attach their
    // own email to the account. No email-change endpoint exists today,
    // but this is defense-in-depth so adding one in the future
    // automatically preserves the binding.
    if (payload.email !== user.email) {
      throw new BadRequestException(
        'Verification token does not match the current email on this account — please request a fresh verification email',
      );
    }

    // Update user to verified
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // Recompute trust score to account for email verification (+10 points)
    await this.fraud.computeTrustScore(user.id);      // Audit: email verified — key identity signal
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'email_verified',
        targetType: 'user',
        targetId: user.id,
      });

    return {
      message: 'Email verified successfully',
      email: user.email,
    };
  }

  /** ── Two-Factor Authentication (TOTP) ──
   *  Enrollment is a two-step flow:
   *    1. `setupTwoFactor` mints a secret and stores it (twoFactorEnabled stays
   *       false). The client renders the otpauth URL as a QR code.
   *    2. `enableTwoFactor` verifies a code against the stored secret, then
   *       flips twoFactorEnabled to true. Rotation requires disabling with a
   *       current code before setting up a replacement secret.
   *  Disabling requires a valid current code (step-up) to prevent an attacker
   *  who has taken over a session from silently turning MFA off.
   */
  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) {
      throw new BadRequestException('Disable two-factor authentication before setting up a new secret');
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encryptTotpSecret(secret) },
    });

    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(secret, user.email || userId),
    };
  }

  async enableTwoFactor(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Call setupTwoFactor before enabling 2FA');
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid or expired 2FA code');
    }
    const updateData: Prisma.UserUpdateInput = { twoFactorEnabled: true };
    if (!this.isEncryptedTotpSecret(user.twoFactorSecret)) {
      updateData.twoFactorSecret = this.encryptTotpSecret(secret);
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
    void this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'two_factor_enabled',
      targetType: 'user',
      targetId: userId,
    });
    return { twoFactorEnabled: true };
  }

  async disableTwoFactor(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      // Already disabled — idempotent success.
      return { twoFactorEnabled: false };
    }
    const secret = this.decryptTotpSecret(user.twoFactorSecret);
    if (!secret || !verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid or expired 2FA code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    void this.audit.log({
      actorId: userId,
      actorRole: user.role,
      action: 'two_factor_disabled',
      targetType: 'user',
      targetId: userId,
    });
    return { twoFactorEnabled: false };
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
    if (!user || !isActiveAccountStatus(user.status)) {
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

    if (!isActiveAccountStatus(user.status)) {
      // Do not disclose account status; treat as invalid token.
      throw new BadRequestException('Invalid or expired reset token');
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
    void this.audit.log({
      actorId: user.id,
      actorRole: user.role,
      action: 'password_reset',
      targetType: 'user',
      targetId: user.id,
    });

    return { message: 'Password reset successfully. Please sign in with your new password.' };
  }

  /** Stable fingerprint of the current password hash (or its absence) */
  private passwordFingerprint(passwordHash: string | null): string {
    return createHash('sha256')
      .update(passwordHash ?? 'no-password')
      .digest('hex')
      .slice(0, 16);
  }

  private assertTwoFactorSatisfied(
    user: { id: string; role: string; twoFactorEnabled?: boolean; twoFactorSecret?: string | null },
    token?: string,
  ) {
    if (!user.twoFactorEnabled) return;
    const secret = user.twoFactorSecret ? this.decryptTotpSecret(user.twoFactorSecret) : null;
    if (!secret) {
      // TOTP was enabled but the encrypted secret is missing/unrecoverable
      // (e.g. key rotation). Treat as a hard failure — never bypass 2FA.
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: '2fa_secret_missing' },
      });
      throw new UnauthorizedException('Two-factor authentication is required but misconfigured');
    }
    // No token supplied yet → emit a structured 2FA challenge so clients
    // (web, CLI, VS Code) can prompt for the code and resubmit, rather than
    // returning the same generic "invalid credentials" as a bad password.
    if (!token) {
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_2fa_challenge',
        targetType: 'user',
        targetId: user.id,
      });
      throw new UnauthorizedException({
        message: 'Two-factor authentication code required',
        twoFactorRequired: true,
      });
    }
    if (!verifyTotp(secret, token)) {
      void this.audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: 'login_failed',
        targetType: 'user',
        targetId: user.id,
        afterSnap: { reason: 'bad_2fa' },
      });
      throw new UnauthorizedException('Invalid two-factor authentication code');
    }
  }

  private buildTotpEncryptionKey(): Buffer {
    const configured = this.config.get<string>('TOTP_SECRET_ENCRYPTION_KEY', '');
    if (configured && configured.length >= 32) {
      return createHash('sha256').update(configured).digest();
    }
    if (this.config.get<string>('NODE_ENV', 'development') === 'production') {
      throw new Error(
        'TOTP_SECRET_ENCRYPTION_KEY must be set to a 32+ character secret in production.',
      );
    }
    this.logger.warn(
      'TOTP_SECRET_ENCRYPTION_KEY is not set or too short. Using a stable development/test fallback key. Do NOT run this in production!',
    );
    return createHash('sha256').update('stable-development-totp-encryption-fallback-key-32-chars').digest();
  }

  private isEncryptedTotpSecret(value: string): boolean {
    return value.startsWith('v1:');
  }

  private encryptTotpSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.totpEncryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  private decryptTotpSecret(stored: string): string | null {
    if (!this.isEncryptedTotpSecret(stored)) {
      return stored;
    }
    const [, ivRaw, tagRaw, encryptedRaw] = stored.split(':');
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.totpEncryptionKey,
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }

  private sanitizeUser<T extends { passwordHash?: unknown; twoFactorSecret?: unknown }>(
    user: T,
  ): Omit<T, 'passwordHash' | 'twoFactorSecret'> {
    const { passwordHash: _passwordHash, twoFactorSecret: _twoFactorSecret, ...safe } = user;
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
