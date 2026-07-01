import { Injectable } from '@nestjs/common';
import { Prisma } from '@waitlayer/db';
import { PrismaService } from '../config/prisma.service';

export interface AuditLogEntry {
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  // JSON columns are typed with Prisma's InputJsonValue so callers are
  // constrained to JSON-serializable shapes and the create() call type-checks.
  beforeSnap?: Prisma.InputJsonValue;
  afterSnap?: Prisma.InputJsonValue;
  ipHash?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Persist an audit log entry. Fire-and-forget — never blocks the caller.
   * Errors are logged but not surfaced to avoid disrupting the primary flow.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          beforeSnap: entry.beforeSnap ?? undefined,
          afterSnap: entry.afterSnap ?? undefined,
          ipHash: entry.ipHash,
        },
      });
    } catch (err) {
      // Audit logging must never break the primary operation.
      // In production, pipe this to an alerting channel instead.
      console.error('[AuditService] Failed to write audit log:', err);
    }
  }

  /**
   * Query audit logs with pagination and filtering.
   * Mirrors the filtering already supported by AdminService.getAuditLog
   * but adds actorRole and proper pagination via cursor or offset.
   */
  async query(params: {
    actorId?: string;
    actorRole?: string;
    targetType?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.actorId) where.actorId = params.actorId;
    if (params.actorRole) where.actorRole = params.actorRole;
    if (params.targetType) where.targetType = params.targetType;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
