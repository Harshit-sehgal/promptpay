import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { Prisma } from '@waitlayer/db';
import { DEFAULT_COMPANY_NAME, UserRole } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import { privacyPseudonym } from '../common/utils/privacy-hash';
import { PrismaService } from '../config/prisma.service';
import { audienceIncludes, TokenPayload } from './auth.constants';
import { AuthEmailTrait } from './auth-email.trait';
import { AuthSessionTrait } from './auth-session.trait';
import { AuthTotpTrait } from './auth-totp.trait';
import { GoogleOAuthDto, LoginDto, SignUpDto } from './dto';
import { normalizeAuthEmail } from './email-normalization';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

// Cost-matched dummy hash for unknown/social-only/inactive accounts. Performing
// exactly one bcrypt comparison on every password-login path prevents account
// existence and account-type timing oracles.
const DUMMY_PASSWORD_HASH = '$2b$12$yM0nJf2yL6WOrYktKZzAruQ79UYryiVNYm7ldEcj53Z/l2mVxLzyS';

export class AuthCoreTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare googleVerifier: GoogleTokenVerifier;
  declare audit: AuditService;
  declare jwtSecret: string;
  declare publicKey: string;

  /** ── Sign Up ── */
  async signUp(dto: SignUpDto) {
    const email = normalizeAuthEmail(dto.email);
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
    const existing = await this.findUserByAuthEmail(email);
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const referralCode = await this.generateReferralCode();
    const { user } = await this.prisma.$transaction(async (tx) => {
      let createdUser;
      let candidateReferralCode = referralCode;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          createdUser = await tx.user.create({
            data: {
              email,
              passwordHash,
              name: dto.name,
              role: dto.role,
              country: dto.country,
              referralCode: candidateReferralCode,
            },
          });
          break;
        } catch (err: unknown) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
            throw err;
          }
          if (uniqueViolationIncludes(err, 'email')) {
            throw new ConflictException('Email already registered');
          }
          if (uniqueViolationIncludes(err, 'referral')) {
            candidateReferralCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
            continue;
          }
          throw err;
        }
      }
      if (!createdUser) throw new ConflictException('Could not allocate a unique referral code');
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
            billingEmail: email,
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
      await this.audit.logStrict(
        {
          actorId: createdUser.id,
          actorRole: createdUser.role,
          action: 'signup',
          targetType: 'user',
          targetId: createdUser.id,
          afterSnap: { role: createdUser.role },
        },
        tx,
      );
      await this.logSignupConsents(createdUser, consentRows, 'signup', tx);
      return { user: createdUser, consentRows };
    });
    const tokens = await this.generateTokenPair(user.id, user.role);
    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  /** ── Login ── */
  async login(dto: LoginDto) {
    const email = normalizeAuthEmail(dto.email);
    const user = await this.findUserByAuthEmail(email);
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid || !user.passwordHash || !isActiveAccountStatus(user.status)) {
      // Audit: login attempt for unknown email
      await this.audit.logStrict({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'login_failed',
        targetType: 'user',
        targetId: user?.id ?? privacyPseudonym(email, 'login-target'),
        afterSnap: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.assertTwoFactorSatisfied(user, dto.twoFactorToken, dto.twoFactorBackupCode);
    await this.audit.logStrict({
      actorId: user.id,
      actorRole: user.role,
      action: 'login_success',
      targetType: 'user',
      targetId: user.id,
    });
    const tokens = await this.generateTokenPair(
      user.id,
      user.role,
      undefined,
      user.twoFactorEnabled ? Math.floor(Date.now() / 1000) : undefined,
    );
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
    const email = normalizeAuthEmail(payload.email);
    const name = payload.name || undefined;
    const role = dto.role || UserRole.DEVELOPER;
    // 1. Find by googleId
    let user = await this.prisma.user.findUnique({ where: { googleId } });
    if (user) {
      // Existing Google user — just login
      if (!isActiveAccountStatus(user.status)) {
        throw new UnauthorizedException('Invalid credentials');
      }
      await this.assertTwoFactorSatisfied(user, dto.twoFactorToken, dto.twoFactorBackupCode);
      const tokens = await this.generateTokenPair(
        user.id,
        user.role,
        undefined,
        user.twoFactorEnabled ? Math.floor(Date.now() / 1000) : undefined,
      );
      return { user: this.sanitizeUser(user), ...tokens };
    }
    // 2. Find by email — REFUSE silent email-link to prevent account takeover.
    //    If an attacker registers a Google account with a victim's email and
    //    presents its ID token, linking by email alone would silently grant
    //    them tokens for the victim's pre-existing password account. The
    //    user must explicitly link Google from inside the existing account
    //    (see /auth/link/google) after proving ownership via password or a
    //    fresh signed email-link request.
    const existingByEmail = await this.findUserByAuthEmail(email);
    if (existingByEmail) {
      // Audit the attempted takeover so the real owner can detect it.
      await this.audit.logStrict({
        actorId: 'anonymous',
        actorRole: 'anonymous',
        action: 'google_link_blocked_existing_email',
        targetType: 'user',
        targetId: existingByEmail.id,
        afterSnap: { reason: 'existing_email_requires_explicit_link' },
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
      let createdUser;
      let candidateReferralCode = referralCode;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          createdUser = await tx.user.create({
            data: {
              email,
              googleId,
              name,
              role,
              googleVerified: true,
              emailVerified: true,
              referralCode: candidateReferralCode,
            },
          });
          break;
        } catch (err: unknown) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
            throw err;
          }
          if (uniqueViolationIncludes(err, 'email') || uniqueViolationIncludes(err, 'google')) {
            throw new ConflictException('Account already exists');
          }
          if (uniqueViolationIncludes(err, 'referral')) {
            candidateReferralCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
            continue;
          }
          throw err;
        }
      }
      if (!createdUser) throw new ConflictException('Could not allocate a unique referral code');
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
      await this.audit.logStrict(
        {
          actorId: createdUser.id,
          actorRole: createdUser.role,
          action: 'google_signup',
          targetType: 'user',
          targetId: createdUser.id,
          afterSnap: { role: createdUser.role, googleVerified: true },
        },
        tx,
      );
      await this.logSignupConsents(createdUser, consentRows, 'google_signup', tx);
      return { user: createdUser, consentRows };
    });
    user = googleSignup.user;
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
        secret: this.publicKey,
        algorithms: ['RS256'],
        issuer: this.config.get<string>('JWT_ISSUER', 'waitlayer'),
        audience: this.config.get<string>('JWT_AUDIENCE', 'waitlayer-client'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!audienceIncludes(payload.aud, 'refresh') || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }
    const jti = payload.jti;
    // Serialize all rotations/reuse handling in a token family. The advisory
    // transaction lock closes the race where a replay revokes a family before
    // the winning request has inserted its child session.
    const familyLock = payload.family ?? jti;
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${familyLock}, 0))`;
      const revokeResult = await tx.session.updateMany({
        where: { id: jti, userId: payload.sub, revoked: false },
        data: { revoked: true },
      });
      if (revokeResult.count === 0) {
        const racedSession = await tx.session.findUnique({
          where: { id: jti },
          select: { tokenFamily: true },
        });
        // When the session row still exists, revoke the entire family it
        // belongs to — the CAS-lose signals token reuse and the DB-truth
        // family is the server's view of which devices are siblings.
        //
        // When the session row is gone (cleanup cron prunes it after
        // expiresAt + 7d), there is no DB-truth family to revoke. The
        // `payload.family` claim is self-asserted by the JWT bearer and
        // must NOT be trusted as a revocation target. Just reject.
        if (racedSession) {
          await tx.session.updateMany({
            where: {
              userId: payload.sub,
              ...(racedSession.tokenFamily ? { tokenFamily: racedSession.tokenFamily } : {}),
            },
            data: { revoked: true },
          });
        }
        await this.audit.logStrict(
          {
            actorId: payload.sub,
            actorRole: 'unknown',
            action: 'refresh_reuse_detected',
            targetType: 'session',
            targetId: jti,
            afterSnap: {
              reason: 'cas_lost',
              sessionRowGone: !racedSession,
              family: racedSession?.tokenFamily ?? null,
            },
          },
          tx,
        );
        return { error: 'reuse' as const };
      }

      const session = await tx.session.findUnique({ where: { id: jti } });
      if (!session) return { error: 'invalid' as const };
      if (!(await this.verifyRefreshTokenHash(refreshToken, session.tokenHash))) {
        await tx.session.updateMany({
          where: {
            userId: payload.sub,
            ...(session.tokenFamily ? { tokenFamily: session.tokenFamily } : {}),
          },
          data: { revoked: true },
        });
        await this.audit.logStrict(
          {
            actorId: payload.sub,
            actorRole: 'unknown',
            action: 'refresh_reuse_detected',
            targetType: 'session',
            targetId: jti,
            afterSnap: { reason: 'hash_mismatch', family: session.tokenFamily },
          },
          tx,
        );
        return { error: 'hash' as const };
      }
      const user = await tx.user.findUnique({ where: { id: payload.sub } });
      if (!user || !isActiveAccountStatus(user.status)) return { error: 'inactive' as const };
      const tokens = await this.generateTokenPair(
        user.id,
        user.role,
        session.tokenFamily || undefined,
        payload.mfaAt,
        tx,
      );
      return { tokens };
    });
    if ('tokens' in outcome) return outcome.tokens;
    if (outcome.error === 'reuse') {
      throw new UnauthorizedException('Token reuse detected — family sessions revoked');
    }
    if (outcome.error === 'hash') {
      throw new UnauthorizedException('Token hash mismatch — family sessions revoked');
    }
    throw new UnauthorizedException('Invalid refresh session');
  }

  /** ── Logout ── */
  async logout(userId: string, jti?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { userId, ...(jti ? { id: jti } : {}) },
        data: { revoked: true },
      });
      await this.audit.logStrict(
        {
          actorId: userId,
          actorRole: user?.role ?? 'unknown',
          action: 'logout',
          targetType: 'session',
          targetId: jti ?? userId,
        },
        tx,
      );
    });
    return { loggedOut: true };
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
        // Surface the TOTP enrollment flag so clients (web settings +
        // payouts 2FA gate, CLI/VSCode trust display) see the real value.
        // Previously this column was omitted from the `select`, so `/auth/me`
        // never carried it — the shared `MeResponse` contract, which DOES
        // list `twoFactorEnabled`, drifted silently and the web UI's
        // "verified" badge fell back to `false` even for enrolled users.
        twoFactorEnabled: true,
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

  async findUserByAuthEmail(email: string) {
    const canonical = normalizeAuthEmail(email);
    const exact = await this.prisma.user.findUnique({ where: { email: canonical } });
    if (exact) return exact;
    // Transitional compatibility until the canonicalization migration has
    // normalized legacy mixed-case rows.
    return this.prisma.user.findFirst({
      where: { email: { equals: canonical, mode: 'insensitive' } },
    });
  }
}
export interface AuthCoreTrait extends AuthTotpTrait, AuthSessionTrait, AuthEmailTrait {}

function uniqueViolationIncludes(
  error: Prisma.PrismaClientKnownRequestError,
  field: string,
): boolean {
  return JSON.stringify(error.meta?.target ?? '')
    .toLowerCase()
    .includes(field.toLowerCase());
}
