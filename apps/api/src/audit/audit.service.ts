import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

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
 * Durable outbox row shape. Mirrors AuditLogEntry plus retry metadata.
 */
export interface AuditOutboxRow {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  beforeSnap: Prisma.JsonValue;
  afterSnap: Prisma.JsonValue;
  ipHash: string | null;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: Date;
  processedAt: Date | null;
  createdAt: Date;
}

/**
 * Persist a security- or money-critical audit entry inside a transaction.
 * Unlike `log`, this deliberately propagates database errors: callers that
 * require an auditable state transition must fail closed rather than return
 * success while the evidence is only queued.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private retryTimer?: NodeJS.Timeout;
  private drainPromise: Promise<number> | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // Drain the durable outbox every 30 seconds. Failed best-effort audit
    // writes are retried until they succeed, so transient audit-table outages
    // no longer silently lose history.
    this.retryTimer = setInterval(() => {
      void this.processOutbox().catch(() => {
        // Keep retrying on the next tick; rows remain in the outbox.
      });
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /**
   * Persist a security- or money-critical audit entry before the operation is
   * acknowledged. Unlike `log`, this deliberately propagates database errors:
   * callers that require an auditable state transition must fail closed rather
   * than return success while the evidence is only queued in memory.
   */
  async logStrict(
    entry: AuditLogEntry,
    client?: Pick<Prisma.TransactionClient, 'auditLog'>,
  ): Promise<void> {
    await this.write(entry, client);
  }

  /**
   * Persist an audit log entry. Never blocks the caller. On a database write
   * failure the entry is written to the durable `AuditOutbox` table and
   * retried later by `processOutbox`, so transient outages preserve audit
   * history without losing in-memory state on process restart.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.write(entry);
    } catch (err) {
      // Durably queue for retry rather than lose the entry.
      await this.enqueueOutbox(entry, err);
    }
  }

  /**
   * Drain pending outbox rows into `AuditLog`. Returns the number of rows
   * successfully processed. Safe to call concurrently: serialised by
   * `drainPromise`.
   */
  async processOutbox(batchSize = 100): Promise<number> {
    if (this.drainPromise) {
      return this.drainPromise;
    }
    this.drainPromise = this.processOutboxUnsafe(batchSize);
    try {
      return await this.drainPromise;
    } finally {
      this.drainPromise = null;
    }
  }

  private async processOutboxUnsafe(batchSize: number): Promise<number> {
    const now = new Date();
    const rows = await this.prisma.auditOutbox.findMany({
      where: { nextRetryAt: { lte: now }, processedAt: null, failedAt: null },
      orderBy: { nextRetryAt: 'asc' },
      take: batchSize,
    });

    let processed = 0;
    for (const row of rows) {
      try {
        await this.write(this.outboxRowToEntry(row));
        await this.prisma.auditOutbox.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
        processed++;
      } catch (err) {
        const retryCount = row.retryCount + 1;
        const maxRetries = row.maxRetries ?? 10;
        const delayMs = Math.min(2 ** Math.min(retryCount, 10), 2 ** 10) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);
        const lastError = (err as Error).message ?? String(err);

        if (retryCount >= maxRetries) {
          await this.prisma.auditOutbox.update({
            where: { id: row.id },
            data: { retryCount, lastError, failedAt: new Date() },
          });
          this.logger.error(
            `Audit outbox row ${row.id} (${row.action}) exceeded max retries (${maxRetries}); moved to dead letter.`,
          );
        } else {
          await this.prisma.auditOutbox.update({
            where: { id: row.id },
            data: { retryCount, lastError, nextRetryAt },
          });
        }
      }
    }
    return processed;
  }

  private async enqueueOutbox(entry: AuditLogEntry, err: unknown): Promise<void> {
    try {
      await this.prisma.auditOutbox.create({
        data: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          beforeSnap: entry.beforeSnap ?? undefined,
          afterSnap: entry.afterSnap ?? undefined,
          ipHash: entry.ipHash,
          nextRetryAt: new Date(),
          lastError: (err as Error).message ?? String(err),
        },
      });
      this.logger.warn(
        `Audit log write failed; queued to durable outbox for retry: ${
          (err as Error).message ?? String(err)
        }`,
      );
    } catch (enqueueErr) {
      // Outbox itself is unavailable — log to stderr as a last resort. This
      // is the best we can do without another durable store.
      this.logger.error(
        `Failed to persist audit outbox row; audit entry may be lost: ${
          (enqueueErr as Error).message ?? String(enqueueErr)
        }`,
      );
    }
  }

  private outboxRowToEntry(row: AuditOutboxRow): AuditLogEntry {
    return {
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      beforeSnap: (row.beforeSnap ?? undefined) as Prisma.InputJsonValue,
      afterSnap: (row.afterSnap ?? undefined) as Prisma.InputJsonValue,
      ipHash: row.ipHash ?? undefined,
    };
  }

  private async write(
    entry: AuditLogEntry,
    client: Pick<PrismaService, 'auditLog'> | Pick<Prisma.TransactionClient, 'auditLog'> = this
      .prisma,
  ): Promise<void> {
    await client.auditLog.create({
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
