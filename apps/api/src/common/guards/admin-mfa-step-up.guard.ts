import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AdminStepUpRequest {
  method?: string;
  user?: {
    role?: string;
    twoFactorEnabled?: boolean;
    mfaAt?: number;
  };
}

/** Require recent TOTP proof for privileged state changes in production. */
@Injectable()
export class AdminMfaStepUpGuard implements CanActivate {
  private readonly production: boolean;
  private readonly maxAgeSeconds: number;

  constructor(config: ConfigService) {
    this.production = config.get<string>('NODE_ENV') === 'production';
    this.maxAgeSeconds = config.get<number>('ADMIN_MFA_STEP_UP_MAX_AGE_SECONDS', 600);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminStepUpRequest>();
    if (!this.production || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
      return true;
    }
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') return true;
    const mfaAt = req.user.mfaAt;
    const age = mfaAt ? Math.floor(Date.now() / 1000) - mfaAt : Number.POSITIVE_INFINITY;
    if (!req.user.twoFactorEnabled || age < 0 || age > this.maxAgeSeconds) {
      throw new ForbiddenException(
        'Recent two-factor authentication is required for this admin action',
      );
    }
    return true;
  }
}
