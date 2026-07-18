import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService outbox', () => {
  let prisma: PrismaService;
  let audit: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: { create: vi.fn() },
      auditOutbox: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'log-1' });
    await audit.log(entry);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'user-1', action: 'test_action' }),
      }),
    );
    expect(prisma.auditOutbox.create).not.toHaveBeenCalled();
  });

  it('queues to the durable outbox when the direct write fails', async () => {
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    (prisma.auditOutbox.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'outbox-1' });

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

  it('processOutbox drains pending rows into AuditLog and marks them processed', async () => {
    const outboxRow = {
      id: 'outbox-1',
      ...entry,
      retryCount: 0,
      lastError: null,
      nextRetryAt: new Date(Date.now() - 1_000),
      processedAt: null,
      createdAt: new Date(),
    };
    (prisma.auditOutbox.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([outboxRow]);
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'log-1' });
    (prisma.auditOutbox.update as ReturnType<typeof vi.fn>).mockResolvedValue(outboxRow);

    const processed = await audit.processOutbox();

    expect(processed).toBe(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'user-1', action: 'test_action' }),
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
    (prisma.auditOutbox.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([outboxRow]);
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('still down'));
    (prisma.auditOutbox.update as ReturnType<typeof vi.fn>).mockResolvedValue(outboxRow);

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
    (prisma.auditOutbox.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([outboxRow]);
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('still down'));
    (prisma.auditOutbox.update as ReturnType<typeof vi.fn>).mockResolvedValue(outboxRow);

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
});
