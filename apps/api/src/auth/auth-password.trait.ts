import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../email/email.service';
import { PasswordResetPayload } from './auth.constants';
import { AuthEmailTrait } from './auth-email.trait';
import { AuthSessionTrait } from './auth-session.trait';
import { AuthTotpTrait } from './auth-totp.trait';

export class AuthPasswordTrait {
  declare prisma: PrismaService;
  declare jwt: JwtService;
  declare config: ConfigService;
  declare email: EmailService;
  declare audit: AuditService;
  declare jwtSecret: string;

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
}
export interface AuthPasswordTrait extends AuthSessionTrait, AuthEmailTrait, AuthTotpTrait {}
