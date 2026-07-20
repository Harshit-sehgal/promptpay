import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';

/**
 * DB-backed lifecycle test for the durable audit outbox.
 *
 * Proves the backlog #7 contract end to end against a real Postgres:
 *   1. An `audit_outbox` row created INSIDE a Prisma transaction is present
 *      after the transaction commits (atomic with the business state).
 *   2. The outbox processor (`AuditService.processOutbox`, which the leased
 *      `AuditOutboxCron` invokes) eventually publishes that committed row
 *      into `audit_logs` and marks it processed — i.e. the audit event is
 *      durably published AFTER the transaction commits, so a downstream
 *      publisher failure cannot lose a committed audit record.
 */
describe('Audit outbox lifecycle (durable post-commit publishing)', () => {
  let prisma: PrismaService;
  let audit: AuditService;

  beforeAll(async () => {
    // Re-use the same DATABASE_URL the API integration tests use.
    prisma = new PrismaService();
    await prisma.onModuleInit();
    audit = new AuditService(prisma);
  });

  beforeEach(async () => {
    // Integration tests share one Postgres; isolate each run.
    await prisma.auditOutbox.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect?.();
  });

  it('keeps an outbox row created inside a tx present after the transaction commits', async () => {
    const id = randomUUID();
    const actorId = 'lifecycle-commit-user';

    await prisma.$transaction(async (tx) => {
      await tx.auditOutbox.create({
        data: {
          id,
          actorId,
          actorRole: 'developer',
          action: 'lifecycle_commit_action',
          targetType: 'payout_request',
          targetId: 'lifecycle-commit-target',
          beforeSnap: { requestedAmountMinor: '1000', currency: 'USD' },
          afterSnap: { status: 'submitted' },
          nextRetryAt: new Date(),
        },
      });
    });

    const persisted = await prisma.auditOutbox.findUnique({ where: { id } });
    expect(persisted).not.toBeNull();
    // Still pending: the processor has not run yet.
    expect(persisted!.processedAt).toBeNull();
    expect(persisted!.failedAt).toBeNull();
    expect(persisted!.actorId).toBe(actorId);
  });

  it('publishes a committed pending row into AuditLog and marks it processed', async () => {
    const id = randomUUID();

    // (1) Commit the outbox row inside a transaction (mirrors a real business
    //     write that enqueues the audit event atomically).
    await prisma.$transaction(async (tx) => {
      await tx.auditOutbox.create({
        data: {
          id,
          actorId: 'lifecycle-publish-user',
          actorRole: 'admin',
          action: 'lifecycle_publish_action',
          targetType: 'campaign',
          targetId: 'lifecycle-publish-target',
          beforeSnap: { status: 'draft' },
          afterSnap: { status: 'active' },
          ipHash: 'abc123',
          // Eligible for immediate drain.
          nextRetryAt: new Date(),
        },
      });
    });

    // The row must exist and be unprocessed immediately after commit.
    const before = await prisma.auditOutbox.findUnique({ where: { id } });
    expect(before).not.toBeNull();
    expect(before!.processedAt).toBeNull();

    // (2) Run the processor (the leased AuditOutboxCron delegates here).
    const processed = await audit.processOutbox();
    expect(processed).toBeGreaterThanOrEqual(1);

    // (3) The outbox row is now marked published (processed).
    const after = await prisma.auditOutbox.findUnique({ where: { id } });
    expect(after).not.toBeNull();
    expect(after!.processedAt).not.toBeNull();
    expect(after!.failedAt).toBeNull();

    // (4) The audit event was durably published into AuditLog, keyed on the
    //     outbox id so a replay can never duplicate it.
    const published = await prisma.auditLog.findFirst({
      where: { sourceOutboxId: id },
    });
    expect(published).not.toBeNull();
    expect(published!.actorId).toBe('lifecycle-publish-user');
    expect(published!.actorRole).toBe('admin');
    expect(published!.action).toBe('lifecycle_publish_action');
    expect(published!.targetType).toBe('campaign');
    expect(published!.targetId).toBe('lifecycle-publish-target');
    expect(published!.ipHash).toBe('abc123');
    expect(published!.beforeSnap).toMatchObject({ status: 'draft' });
    expect(published!.afterSnap).toMatchObject({ status: 'active' });
  });

  it('does not duplicate the audit log when the processor runs twice on the same row', async () => {
    const id = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.auditOutbox.create({
        data: {
          id,
          actorId: 'lifecycle-idempotent-user',
          actorRole: 'developer',
          action: 'lifecycle_idempotent_action',
          targetType: 'payout_request',
          targetId: 'lifecycle-idempotent-target',
          nextRetryAt: new Date(),
        },
      });
    });

    await audit.processOutbox();
    // Second drain must be a no-op for the already-published row.
    const second = await audit.processOutbox();
    expect(second).toBe(0);

    const published = await prisma.auditLog.findMany({
      where: { sourceOutboxId: id },
    });
    expect(published).toHaveLength(1);
  });
});
