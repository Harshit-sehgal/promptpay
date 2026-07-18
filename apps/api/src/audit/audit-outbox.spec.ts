import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { captureMessage } from '@sentry/nestjs';

import { PrismaService } from '../config/prisma.service';
import { AuditService } from './audit.service';
vi.mock('@sentry/nestjs', () => ({
  captureMessage: vi.fn(),
}));

describe('AuditService outbox', () => {
  let prisma: PrismaService;
  let audit: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: { create: vi.fn(), upsert: vi.fn() },
      auditOutbox: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      // processOutbox is invoked by the leased AuditOutboxCron (the sole
      // scheduler); it is also safe to call directly. $transaction here invokes
      // the callback with the same mock so upsert/update assertions land on
      // `prisma` (tx === prisma).
      $transaction: vi.fn(async (cb: (tx: PrismaService) => Promise<unknown>) => cb(prisma)),
    } as unknown as PrismaService;
    audit = new AuditService(prisma);
  });

  const entry = {
    actorId: 'user-1',
    actorRole: 'developer',
    action: 'test_action',
    targetType: 'test',
    targetId: 'target-1',
    beforeSnap: { foo: 'bar' },
  };

  it('writes directly to AuditLog when the direct write succeeds', async () => {
    (prisma.auditLog.create as Mock).mockResolvedValue({ id: 'log-1' });
    await audit.log(entry);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'user-1', action: 'test_action' }),
      }),
    );
    expect(prisma.auditOutbox.create).not.toHaveBeenCalled();
  });

  it('queues to the durable outbox when the direct write fails', async () => {
    (prisma.auditLog.create as Mock).mockRejectedValue(new Error('db down'));
    (prisma.auditOutbox.create as Mock).mockResolvedValue({ id: 'outbox-1' });

    await audit.log(entry);

    expect(prisma.auditOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'user-1',
          action: 'test_action',
          nextRetryAt: expect.any(Date),
          lastError: 'db down',
        }),
      }),
    );
  });

  it('processOutbox drains pending rows into AuditLog (idempotently) and marks them processed', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockResolvedValue({ id: 'log-1' });
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);

    const processed = await audit.processOutbox();

    expect(processed).toBe(1);
    // Upsert keyed on sourceOutboxId guarantees replay cannot duplicate the audit row.
    expect(prisma.auditLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceOutboxId: 'outbox-1' },
        create: expect.objectContaining({
          actorId: 'user-1',
          action: 'test_action',
          sourceOutboxId: 'outbox-1',
        }),
        update: {},
      }),
    );
    expect(prisma.auditOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: { processedAt: expect.any(Date) },
      }),
    );
  });

  it('processOutbox increments retryCount and delays on failure', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      maxRetries: 10,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      failedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockRejectedValue(new Error('still down'));
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);

    const processed = await audit.processOutbox();

    expect(processed).toBe(0);
    expect(prisma.auditOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          retryCount: 1,
          lastError: 'still down',
          nextRetryAt: expect.any(Date),
        }),
      }),
    );
  });

  it('processOutbox moves a row to dead letter after max retries', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 9,
      maxRetries: 10,
      lastError: 'still down',
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      failedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockRejectedValue(new Error('still down'));
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);

    const processed = await audit.processOutbox();

    expect(processed).toBe(0);
    expect(prisma.auditOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'outbox-1' },
        data: expect.objectContaining({
          retryCount: 10,
          lastError: 'still down',
          failedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('replays an unprocessed outbox row without duplicating the audit log', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockResolvedValue({ id: 'log-1' });
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);

    await audit.processOutbox();
    await audit.processOutbox();

    // Crash after the audit insert but before processedAt: the row is still
    // pending, so a second drain re-upserts with the same sourceOutboxId.
    expect(prisma.auditLog.upsert).toHaveBeenCalledTimes(2);
    for (const call of (prisma.auditLog.upsert as Mock).mock.calls) {
      expect(call[0].where).toEqual({ sourceOutboxId: 'outbox-1' });
    }
  });

  it('survives a crash after the audit insert but before processedAt is committed', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockResolvedValue({ id: 'log-1' });
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);
    // The drain transaction commits the audit insert, then drops before
    // processedAt is persisted — simulating a crash / failover mid-transaction.
    (prisma.$transaction as Mock).mockImplementation(
      async (cb: (tx: PrismaService) => Promise<unknown>) => {
        await cb(prisma);
        throw new Error('connection dropped after audit insert');
      },
    );

    await audit.processOutbox();
    await audit.processOutbox();

    // The audit row is upserted on the stable sourceOutboxId each attempt, so a
    // crash between insert and processedAt can never create a duplicate.
    expect(prisma.auditLog.upsert).toHaveBeenCalledTimes(2);
    for (const call of (prisma.auditLog.upsert as Mock).mock.calls) {
      expect(call[0].where).toEqual({ sourceOutboxId: 'outbox-1' });
    }
  });

  it('serializes concurrent processOutbox calls within a single process', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([outboxRow]);
    (prisma.auditLog.upsert as Mock).mockResolvedValue({ id: 'log-1' });
    (prisma.auditOutbox.update as Mock).mockResolvedValue(outboxRow);

    const [a, b] = await Promise.all([audit.processOutbox(), audit.processOutbox()]);

    // The second call returns the in-flight drain promise; the row is drained once.
    expect(a).toBe(b);
    expect(prisma.auditLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('emits to the independent Sentry sink when both the direct write and outbox write fail', async () => {
    (prisma.auditLog.create as Mock).mockRejectedValue(new Error('db down'));
    (prisma.auditOutbox.create as Mock).mockRejectedValue(new Error('outbox down'));

    await audit.log(entry);

    expect(captureMessage).toHaveBeenCalledWith(
      'audit_outbox_write_failed',
      expect.objectContaining({ level: 'error' }),
    );
  });
});
