import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Prisma } from '@waitlayer/db';
import { DEFAULT_COMPANY_NAME, UserRole } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import { PrismaService } from '../config/prisma.service';
import { TokenPayload } from './auth.constants';
import { AuthEmailTrait } from './auth-email.trait';
import { AuthSessionTrait } from './auth-session.trait';
import { AuthTotpTrait } from './auth-totp.trait';
import { GoogleOAuthDto, LoginDto, SignUpDto } from './dto';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

export class AuthCoreTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare googleVerifier: GoogleTokenVerifier;
  declare audit: AuditService;
  declare jwtSecret: string;

  /** ── Sign Up ── */
  async signUp(dto: SignUpDto) {
    // A-034: every self-service account creation must prove the user accepted
    // the required age/terms/privacy consent. Refuse creation otherwise so the
    // acceptance is auditable per user and policy version.
    if (!dto.ageConfirmed || !dto.termsAccepted) {
      throw new BadRequestException(
        'You must confirm you are 18+ and accept the Terms and Privacy Policy to sign up',
      );
    }
    const signupConsentVersions = this.resolveSignupConsentVersions(dto.policyVersion);
    // Optimistic pre-check: catch sequential duplicate signups with a cheap
    // read before paying the bcrypt.hash cost on a doomed insert. Concurrent
    // signups race past this check; the P2002 catch below translates the
    // unique-constraint failure into the same ConflictException so the
    // loser always sees a clean 409 instead of a 500.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const referralCode = await this.generateReferralCode();
    const { user, consentRows } = await this.prisma.$transaction(async (tx) => {
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
          data: {
            userId: createdUser.id,
            companyName: dto.name || DEFAULT_COMPANY_NAME,
            billingEmail: dto.email,
          },
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
      const consentRows = await this.createSignupConsentRecords(
        tx,
        createdUser,
        'signup',
        signupConsentVersions,
      );
      return { user: createdUser, consentRows };
    });
    const tokens = await this.generateTokenPair(user.id, user.role);
    this.logSignupConsents(user, consentRows, 'signup');
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
    // A-034: a brand-new Google account is still a self-service signup, so the
    // client must have collected age/terms consent first. Existing Google
    // users (matched by googleId above) keep their original acceptance.
    if (!dto.ageConfirmed || !dto.termsAccepted) {
      throw new BadRequestException(
        'You must confirm you are 18+ and accept the Terms and Privacy Policy to sign up',
      );
    }
    const signupConsentVersions = this.resolveSignupConsentVersions(dto.policyVersion);
    const referralCode = await this.generateReferralCode();
    const googleSignup = await this.prisma.$transaction(async (tx) => {
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
          data: {
            userId: createdUser.id,
            companyName: name || DEFAULT_COMPANY_NAME,
            billingEmail: email,
          },
        });
      }
      const consentRows = await this.createSignupConsentRecords(
        tx,
        createdUser,
        'google_signup',
        signupConsentVersions,
      );
      return { user: createdUser, consentRows };
    });
    user = googleSignup.user;
    const tokens = await this.generateTokenPair(user.id, user.role);
    this.logSignupConsents(user, googleSignup.consentRows, 'google_signup');
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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
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
        passwordHash: true,
        googleVerified: true,
        githubVerified: true,
        referralCode: true,
        createdAt: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { ...safeUser, hasPassword: Boolean(_passwordHash) };
  }

  getGoogleClientId() {
    return this.config.get<string>('GOOGLE_CLIENT_ID', '');
  }
}
export interface AuthCoreTrait extends AuthTotpTrait, AuthSessionTrait, AuthEmailTrait {}
