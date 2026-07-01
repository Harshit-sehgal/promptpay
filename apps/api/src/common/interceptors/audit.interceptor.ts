import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../audit/audit.service';
import { Reflector } from '@nestjs/core';

/**
 * Interceptor that automatically logs admin mutation actions to the AuditLog table.
 *
 * Only activates on POST requests under /admin/* routes (mutations).
 * Reads the authenticated user id/role from the request (set by JwtAuthGuard)
 * and extracts the target type and id from the URL pattern.
 *
 * Usage: @UseInterceptors(AuditInterceptor) on individual handler methods,
 *        or apply class-wide on AdminController.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url: string = req.route?.path ?? req.url ?? '';

    // Only audit POST mutations on admin routes
    if (method !== 'POST' || !url.startsWith('/admin/')) {
      return next.handle();
    }

    const actorId = req.user?.sub ?? req.user?.id ?? 'unknown';
    const actorRole = req.user?.role ?? 'admin';

    // Derive action and target from URL
    // URL patterns:
    //   /admin/campaigns/:id/approve  → action=approve, target=campaign
    //   /admin/payouts/:id/reject     → action=reject, target=payout
    //   /admin/fraud/:id/resolve      → action=resolve, target=fraud_flag
    const parsed = parseAdminUrl(url, req.params);

    const now = Date.now();
    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget — don't await, errors handled inside AuditService.log
        this.audit.log({
          actorId,
          actorRole,
          action: parsed.action,
          targetType: parsed.targetType,
          targetId: parsed.targetId,
          ipHash: hashIp(req),
        });
      }),
    );
  }
}

/**
 * Parse admin URL patterns into audit action/target.
 */
function parseAdminUrl(
  url: string,
  params: Record<string, string>,
): { action: string; targetType: string; targetId: string } {
  // /admin/campaigns/:id/approve → action=approve_campaign, target=campaign
  // /admin/payouts/:id/approve   → action=approve_payout, target=payout
  // /admin/fraud/:id/resolve     → action=resolve_fraud_flag, target=fraud_flag

  if (url.includes('/campaigns/') && url.endsWith('/approve')) {
    return { action: 'approve_campaign', targetType: 'campaign', targetId: params['id'] ?? '' };
  }
  if (url.includes('/campaigns/') && url.endsWith('/reject')) {
    return { action: 'reject_campaign', targetType: 'campaign', targetId: params['id'] ?? '' };
  }
  if (url.includes('/payouts/') && url.endsWith('/approve')) {
    return { action: 'approve_payout', targetType: 'payout', targetId: params['id'] ?? '' };
  }
  if (url.includes('/payouts/') && url.endsWith('/reject')) {
    return { action: 'reject_payout', targetType: 'payout', targetId: params['id'] ?? '' };
  }
  if (url.includes('/payouts/') && url.endsWith('/mark-paid')) {
    return { action: 'mark_payout_paid', targetType: 'payout', targetId: params['id'] ?? '' };
  }
  if (url.includes('/fraud/') && url.endsWith('/resolve')) {
    return { action: 'resolve_fraud_flag', targetType: 'fraud_flag', targetId: params['id'] ?? '' };
  }

  // Fallback: derive from last two segments
  const segments = url.replace(/\/$/, '').split('/').filter(Boolean);
  return {
    action: segments.join('_'),
    targetType: segments[1] ?? 'unknown',
    targetId: params['id'] ?? '',
  };
}

/** One-way hash of IP for audit storage — no raw IPs persisted. */
function hashIp(req: Record<string, any>): string | undefined {
  const ip =
    req.ip ??
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ??
    req.connection?.remoteAddress;
  if (!ip || ip === 'unknown') return undefined;

  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}
