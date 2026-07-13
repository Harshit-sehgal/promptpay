import { from, Observable } from 'rxjs';
import { throwError } from 'rxjs';
import { catchError, concatMap, map, switchMap } from 'rxjs/operators';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Prisma } from '@waitlayer/db';

import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../config/prisma.service';
import { privacyPseudonym } from '../utils/privacy-hash';

export const AUDIT_METADATA_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  targetType: string;
  targetIdParam?: string;
}

export const Audit = (action: string, targetType: string, targetIdParam?: string) =>
  SetMetadata(AUDIT_METADATA_KEY, { action, targetType, targetIdParam });

interface AuditedRequest {
  method?: string;
  url?: string;
  route?: { path?: string };
  params: Record<string, string>;
  user?: { sub?: string; id?: string; role?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  connection?: { remoteAddress?: string };
}

/**
 * Interceptor that automatically logs sensitive mutation actions to the AuditLog table.
 *
 * Activates on POST requests under /admin/* and /fraud/* routes, plus any route
 * explicitly opted in via the @Audit decorator. The decorator allows sensitive
 * non-admin mutations (payout requests, account deletion, API key revocation,
 * campaign lifecycle actions, etc.) to be audited without relying on URL parsing.
 * Reads the authenticated user id/role from the request (set by JwtAuthGuard)
 * and extracts the target type and id from the URL pattern.
 *
 * Before the handler executes, the interceptor fetches the target entity's
 * pre-mutation state from the database — the result is stored as
 * `beforeSnap: { body: <scrubbed request>, entity: <pre-state> }`. On
 * success, the audit log records the actor + action + before-state; on
 * failure, `afterSnap` captures the error.
 *
 * Sensitive admin mutations (approve/reject/mark-paid/resolve/toggle) are
 * logged on BOTH success and failure paths: an attempted-but-rejected
 * approval is itself a security-relevant event (an actor tried to bypass a
 * state machine) and must be visible in the audit timeline.
 *
 * Usage: @UseInterceptors(AuditInterceptor) on individual handler methods,
 *        or apply class-wide on AdminController.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private audit: AuditService,
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const method = req.method;
    const url: string = req.route?.path ?? req.url ?? '';

    const auditMeta = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    // Only audit POST mutations on admin routes, plus manually opted-in
    // handlers (FraudController.resolveFlag is not under /admin/ but still
    // needs auditing). When opted in, the interceptor is class-level or
    // method-level via @UseInterceptors, so it runs unconditionally — the
    // guard here ensures we skip GET requests even when opted in.
    if (!auditMeta) {
      if (method !== 'POST') {
        return next.handle();
      }
      if (!url.startsWith('/admin/') && !url.startsWith('/fraud/')) {
        return next.handle();
      }
    }

    const actorId = req.user?.sub ?? req.user?.id ?? 'unknown';
    const actorRole = req.user?.role ?? 'unknown';

    let action: string;
    let targetType: string;
    let targetId: string;

    if (auditMeta) {
      action = auditMeta.action;
      targetType = auditMeta.targetType;
      targetId = auditMeta.targetIdParam ? (req.params[auditMeta.targetIdParam] ?? '') : actorId;
    } else {
      const parsed = parseAdminUrl(url, req.params);
      action = parsed.action;
      targetType = parsed.targetType;
      targetId = parsed.targetId;
    }

    // Fetch the entity's pre-mutation DB state asynchronously, then chain
    // into the handler.
    return from(fetchEntityPreState(this.prisma, targetType, targetId)).pipe(
      switchMap((entitySnap) => {
        const actor = {
          actorId,
          actorRole,
          action,
          targetType,
          targetId,
          ipHash: hashIp(req),
          // beforeSnap now carries both the scrubbed request body AND the
          // entity's current DB state — solving the "what did they change
          // from?" question that a body-only snapshot can't answer.
          beforeSnap: buildBeforeSnap(req.body, entitySnap) as Prisma.InputJsonValue,
        };

        return next.handle().pipe(
          concatMap((value) => {
            // Account erasure has already scrubbed historical audit snapshots
            // and IP pseudonyms. Do not recreate either in the success record;
            // retain only the minimal action/actor/target/time evidence.
            const successActor =
              action === 'delete_account'
                ? { ...actor, ipHash: undefined, beforeSnap: undefined }
                : actor;
            return from(this.audit.logStrict(successActor)).pipe(map(() => value));
          }),
          catchError((err) => {
            // Failed mutation — sensitive admin attempts that errored
            // (state-machine rejections, validation, auth) are themselves
            // a security signal. Record with the same action but tag
            // `afterSnap.error` so the timeline shows the attempt rather
            // than silently dropping it.
            this.audit.log({
              ...actor,
              afterSnap: {
                error: (err && (err.message || String(err))) ?? 'error',
              } as Prisma.InputJsonValue,
            });
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}

/**
 * Build the beforeSnap payload: scrubbed request body + pre-mutation entity
 * state from the DB. Both are captured so the audit reader sees what was
 * requested AND what the entity looked like before the mutation.
 */
function buildBeforeSnap(
  body: Record<string, unknown> | undefined,
  entitySnap: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  const scrubbed = scrubBody(body);
  if (!scrubbed && !entitySnap) return undefined;
  const snap: Record<string, unknown> = {};
  if (scrubbed) snap.body = scrubbed;
  if (entitySnap) snap.entity = entitySnap;
  return snap;
}

/**
 * Fetch the current DB state of the entity being mutated by an admin
 * mutation. Mirrors the mapping in `parseAdminUrl` — queries the relevant
 * Prisma model by id/slug so the audit log can carry the pre-state.
 *
 * **Allow-list, not full row:** each query selects only the fields an
 * auditor needs to reason about a state-machine transition — ids, status,
 * timestamps, reviewer, note — never the full entity. Persisting the full
 * row would carry sensitive/redundant columns (the payout's
 * `payoutAccountId` reference, a fraud flag's `evidence` JSON with IP
 * hashes / userIds, etc.) into an append-only audit table that outlives the
 * source row. The selected projection is the minimal set that still answers
 * "what was the state before the mutation?"
 *
 * Returns `null` when the entity cannot be found (e.g. mis-targeted
 * mutation — the handler will throw, capturing the attempt is still
 * valuable) or the model mapping doesn't exist.
 */
async function fetchEntityPreState(
  prisma: PrismaService,
  targetType: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  if (!targetId) return null;

  switch (targetType) {
    case 'campaign':
      return prisma.campaign.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          approvedAt: true,
          activatedAt: true,
          pausedAt: true,
          budgetTotalMinor: true,
          budgetSpentMinor: true,
        },
      }) as Promise<Record<string, unknown> | null>;
    case 'payout':
      return prisma.payoutRequest.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          requestedAmountMinor: true,
          approvedAmountMinor: true,
          reviewerId: true,
          reviewNote: true,
          processedAt: true,
          paidAt: true,
        },
      }) as Promise<Record<string, unknown> | null>;
    case 'fraud_flag':
      return prisma.fraudFlag.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          status: true,
          severity: true,
          reviewerId: true,
          reviewNote: true,
          resolvedAt: true,
        },
      }) as Promise<Record<string, unknown> | null>;
    case 'tool_integration':
      return prisma.toolIntegration.findUnique({
        where: { slug: targetId },
        select: { slug: true, name: true, isActive: true },
      }) as Promise<Record<string, unknown> | null>;
    case 'api_key':
      return prisma.apiKey.findUnique({
        where: { id: targetId },
        select: { id: true, keyPrefix: true, scopes: true, isActive: true, expiresAt: true },
      }) as Promise<Record<string, unknown> | null>;
    case 'user':
      return prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, status: true },
      }) as Promise<Record<string, unknown> | null>;
    case 'creative':
      return prisma.adCreative.findUnique({
        where: { id: targetId },
        select: { id: true, status: true, campaignId: true, rejectionReason: true },
      }) as Promise<Record<string, unknown> | null>;
    default:
      return null;
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
  if (url.includes('/tools/') && url.endsWith('/toggle')) {
    // Sensitive: tool integrations (an attacker with admin could disable
    // ad-blocking/fraud-detection tools). Surface the slug as the targetId
    // instead of dropping it on the generic fallback.
    return {
      action: 'toggle_tool_integration',
      targetType: 'tool_integration',
      targetId: params['slug'] ?? '',
    };
  }

  // Fallback: derive from last two segments
  const segments = url.replace(/\/$/, '').split('/').filter(Boolean);
  return {
    action: segments.join('_'),
    targetType: segments[1] ?? 'unknown',
    targetId: params['id'] ?? '',
  };
}

/**
 * One-way hash of IP for audit storage — no raw IPs persisted.
 */
function hashIp(req: AuditedRequest): string | undefined {
  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = req.ip ?? forwardedIp?.split(',')[0]?.trim() ?? req.connection?.remoteAddress;
  if (!ip || ip === 'unknown') return undefined;

  return privacyPseudonym(ip, 'audit-ip');
}

/**
 * Capture the request body for the audit `beforeSnap` field. Strip known
 * secret/password fields — passwords and tokens must never appear in the
 * audit log, even though they shouldn't be in admin routes on principle.
 * Returns `undefined` when the body is empty (logging undefined diffs is
 * cheap and JSON keeps the field absent rather than storing an empty
 * object).
 */
export function scrubBody(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (isSensitiveAuditField(k)) {
      out[k] = '[redacted]';
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? scrubBody(item as Record<string, unknown>)
          : item,
      );
    } else if (v && typeof v === 'object') {
      out[k] = scrubBody(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isSensitiveAuditField(field: string): boolean {
  const normalized = field.replace(/[-_\s]/g, '').toLowerCase();
  return (
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('signature') ||
    normalized.includes('privatekey') ||
    normalized === 'apikey' ||
    normalized === 'authorization'
  );
}
