import * as bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { PasswordResetPayload } from './auth.constants';
import { AuthEmailTrait } from './auth-email.trait';
import { AuthSessionTrait } from './auth-session.trait';
import { AuthTotpTrait } from './auth-totp.trait';
import { LinkGoogleDto, SetSocialPasswordDto } from './dto';
import { normalizeAuthEmail } from './email-normalization';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

export class AuthPasswordTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare email: EmailQueueService;
  declare audit: AuditService;
  declare jwtSecret: string;
  declare googleVerifier: GoogleTokenVerifier;

  /** ── Password Reset: Request ──
   *  Always returns a generic message to prevent account enumeration.
   *  The stateless token embeds a fingerprint of the current password hash,
   *  so it self-invalidates as soon as the password changes (single-use).
   */
  async requestPasswordReset(email: string) {
    const generic = {
      message: 'If an account exists for that email, a password reset link has been sent',
    };
    const canonical = normalizeAuthEmail(email);
    const user =
      (await this.prisma.user.findUnique({ where: { email: canonical } })) ??
      (await this.prisma.user.findFirst({
        where: { email: { equals: canonical, mode: 'insensitive' } },
      }));
    if (!user || !isActiveAccountStatus(user.status)) {
      return generic;
    }
    const issuer = this.config.get<string>('JWT_ISSUER', 'waitlayer');
    const token = await this.jwt.signAsync(
      {
        sub: user.id,
        action: 'password-reset',
        fp: this.passwordFingerprint(user.passwordHash),
        iss: issuer,
        aud: 'password-reset',
      },
      { secret: this.jwtSecret, algorithm: 'HS256', expiresIn: '1h' },
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
      payload = await this.jwt.verifyAsync<PasswordResetPayload>(token, {
        secret: this.jwtSecret,
        algorithms: ['HS256'],
        issuer: this.config.get<string>('JWT_ISSUER', 'waitlayer'),
        audience: 'password-reset',
      });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: user.id }, data: { revoked: true } });
      await tx.apiKey.updateMany({ where: { ownerId: user.id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: 'password_reset',
          targetType: 'user',
          targetId: user.id,
        },
      });
    });
    // Best-effort notification — never fail the reset because of email delivery
    void this.email.sendPasswordChanged(user.email).catch(() => undefined);
    return { message: 'Password reset successfully. Please sign in with your new password.' };
  }

  async setSocialAccountPassword(userId: string, currentJti: string, dto: SetSocialPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !isActiveAccountStatus(user.status)) throw new UnauthorizedException();
    if (user.passwordHash) throw new ConflictException('This account already has a password');
    if (!user.googleId) throw new BadRequestException('A linked Google account is required');
    const proof = await this.googleVerifier.verify(dto.googleIdToken);
    if (
      !proof.email_verified ||
      proof.sub !== user.googleId ||
      normalizeAuthEmail(proof.email) !== normalizeAuthEmail(user.email)
    ) {
      throw new UnauthorizedException('Google reauthentication does not match this account');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId, id: { not: currentJti } },
        data: { revoked: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'password_set',
          targetType: 'user',
          targetId: userId,
        },
      });
    });
    void this.email.sendPasswordChanged(user.email).catch(() => undefined);
    return { passwordSet: true };
  }

  async linkGoogle(userId: string, currentJti: string, dto: LinkGoogleDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !isActiveAccountStatus(user.status)) throw new UnauthorizedException();
    if (user.passwordHash) {
      if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }
    const proof = await this.googleVerifier.verify(dto.idToken);
    if (
      !proof.email_verified ||
      normalizeAuthEmail(proof.email) !== normalizeAuthEmail(user.email)
    ) {
      throw new UnauthorizedException('Google account email must match this account');
    }
    const owner = await this.prisma.user.findUnique({ where: { googleId: proof.sub } });
    if (owner && owner.id !== userId)
      throw new ConflictException('Google account is already linked');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { googleId: proof.sub, googleVerified: true, emailVerified: true },
      });
      await tx.session.updateMany({
        where: { userId, id: { not: currentJti } },
        data: { revoked: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: user.role,
          action: 'google_linked',
          targetType: 'user',
          targetId: userId,
        },
      });
    });
    return { googleLinked: true };
  }
}
export interface AuthPasswordTrait extends AuthSessionTrait, AuthEmailTrait, AuthTotpTrait {}
