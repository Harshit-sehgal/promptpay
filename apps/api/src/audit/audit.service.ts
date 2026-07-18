import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

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
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private drainPromise: Promise<number> | null = null;

  constructor(private prisma: PrismaService) {}

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
   * `drainPromise`. The leased `AuditOutboxCron` is the sole scheduler that
   * invokes this; it must not be triggered by a second timer.
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
        await this.drainRow(row);
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

  /**
   * Atomically insert the audit log (idempotently, keyed on the outbox id) and
   * mark the outbox row processed. If this transaction rolls back after the
   * audit insert — a crash, connection drop, or replica failover — the next
   * drain re-attempts: the `sourceOutboxId` unique key makes the upsert a
   * no-op, so replay can never create a duplicate audit record.
   */
  private async drainRow(row: AuditOutboxRow): Promise<void> {
    const entry = this.outboxRowToEntry(row);
    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.upsert({
        where: { sourceOutboxId: row.id },
        create: {
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          beforeSnap: entry.beforeSnap ?? undefined,
          afterSnap: entry.afterSnap ?? undefined,
          ipHash: entry.ipHash,
          sourceOutboxId: row.id,
        },
        update: {},
      });
      await tx.auditOutbox.update({
        where: { id: row.id },
        data: { processedAt: new Date() },
      });
    });
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

  /**
   * List dead-letter rows (audit_outbox rows that exhausted retries and have a
   * non-null failedAt). Resolved rows are excluded unless includeResolved.
   * Operators triage these to recover audit events that never reached AuditLog.
   */
  async listDeadLetter(params?: { page?: number; limit?: number; includeResolved?: boolean }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
    const skip = (page - 1) * limit;
    const where: Prisma.AuditOutboxWhereInput = { failedAt: { not: null } };
    if (!params?.includeResolved) where.resolvedAt = null;

    const [items, total] = await Promise.all([
      this.prisma.auditOutbox.findMany({
        where,
        orderBy: { failedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditOutbox.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /** Count of active (unresolved) dead-letter rows — for dashboards/alerts. */
  async countDeadLetter(): Promise<number> {
    return this.prisma.auditOutbox.count({
      where: { failedAt: { not: null }, resolvedAt: null },
    });
  }

  /**
   * Requeue a dead-letter row for another drain attempt: clears failedAt, resets
   * retryCount, and sets nextRetryAt to now so the leased cron reprocesses it.
   * Emits an immutable operator audit entry (fail-closed) recording the retry.
   */
  async retryDeadLetter(id: string, actor: { actorId: string; actorRole: string }): Promise<void> {
    const row = await this.prisma.auditOutbox.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Audit outbox row ${id} not found`);
    if (row.failedAt === null) return; // not in dead-letter; nothing to retry

    await this.prisma.auditOutbox.update({
      where: { id },
      data: {
        retryCount: 0,
        failedAt: null,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });

    await this.logStrict({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'audit_dead_letter_retry',
      targetType: 'audit_outbox',
      targetId: id,
      beforeSnap: { lastError: row.lastError } as Prisma.InputJsonValue,
      afterSnap: { status: 'requeued' } as Prisma.InputJsonValue,
    });
  }

  /**
   * Resolve a dead-letter row: mark it resolved (resolvedAt/resolvedBy/resolution)
   * so it is excluded from the active dead-letter list, and emit an immutable
   * operator audit entry recording the decision. Resolving is terminal — a
   * resolved row cannot be retried or resolved again.
   */
  async resolveDeadLetter(
    id: string,
    input: { reason: string; actorId: string; actorRole: string },
  ): Promise<void> {
    const row = await this.prisma.auditOutbox.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Audit outbox row ${id} not found`);
    if (row.failedAt === null) {
      throw new BadRequestException(`Audit outbox row ${id} is not in dead-letter`);
    }
    if (row.resolvedAt) {
      throw new ConflictException(`Audit outbox row ${id} is already resolved`);
    }

    await this.prisma.auditOutbox.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolvedBy: input.actorId,
        resolution: input.reason,
      },
    });

    await this.logStrict({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'audit_dead_letter_resolved',
      targetType: 'audit_outbox',
      targetId: id,
      beforeSnap: { lastError: row.lastError } as Prisma.InputJsonValue,
      afterSnap: {
        resolution: input.reason,
        resolvedBy: input.actorId,
      } as Prisma.InputJsonValue,
    });
  }
}
