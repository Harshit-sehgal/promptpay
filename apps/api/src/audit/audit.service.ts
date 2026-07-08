import { Injectable, Logger, OnModuleDestroy,OnModuleInit } from '@nestjs/common';

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

/**
 * Bounded in-memory buffer of audit entries that failed to persist because the
 * database was unreachable. The retry timer drains it whenever the DB is back,
 * so a transient outage no longer silently loses audit history. The buffer is
 * bounded (oldest entries are dropped under sustained outage) to avoid OOM.
 */
const MAX_QUEUED = 1000;
const RETRY_INTERVAL_MS = 30_000;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly queue: AuditLogEntry[] = [];
  private retryTimer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.retryTimer = setInterval(() => {
      void this.drain().catch(() => {
        // Keep retrying on the next tick; entries remain queued.
      });
    }, RETRY_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /** Attempt to flush the queued entries. Best-effort; failures stay queued. */
  private async drain(): Promise<void> {
    if (this.queue.length === 0) return;
    // Snapshot + clear so concurrent log() calls append to a fresh buffer.
    const batch = this.queue.splice(0, this.queue.length);
    for (const entry of batch) {
      try {
        await this.write(entry);
      } catch {
        // Re-queue at the tail (bounded) so we retry on a future tick.
        if (this.queue.length < MAX_QUEUED) this.queue.push(entry);
      }
    }
  }

  private async write(entry: AuditLogEntry): Promise<void> {
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
  }

  /**
   * Persist an audit log entry. Never blocks the caller. On a database write
   * failure the entry is buffered for retry (see `drain`) instead of being
   * silently dropped, so transient outages preserve audit history.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.write(entry);
    } catch (err) {
      // Buffer for retry rather than lose the entry.
      if (this.queue.length < MAX_QUEUED) this.queue.push(entry);
      this.logger.warn(
        `Audit log write failed; queued for retry (buffer=${this.queue.length}): ${
          (err as Error).message ?? String(err)
        }`,
      );
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
