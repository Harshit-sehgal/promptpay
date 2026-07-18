import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService dead-letter operations', () => {
  let prisma: PrismaService;
  let audit: AuditService;

  const deadRow = {
    id: 'dead-1',
    actorId: 'svc-1',
    actorRole: 'system',
    action: 'pay_request',
    targetType: 'payout',
    targetId: 'p-1',
    beforeSnap: null,
    afterSnap: null,
    ipHash: null,
    retryCount: 10,
    maxRetries: 10,
    lastError: 'boom',
    nextRetryAt: new Date(),
    processedAt: null,
    failedAt: new Date('2026-07-19T00:00:00Z'),
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      auditLog: { create: vi.fn(), upsert: vi.fn() },
      auditOutbox: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: PrismaService) => Promise<unknown>) => cb(prisma)),
    } as unknown as PrismaService;
    audit = new AuditService(prisma);
  });

  it('listDeadLetter returns paginated active dead rows (failedAt set, resolvedAt null)', async () => {
    (prisma.auditOutbox.findMany as Mock).mockResolvedValue([deadRow]);
    (prisma.auditOutbox.count as Mock).mockResolvedValue(1);

    const res = await audit.listDeadLetter({ page: 2, limit: 10 });

    expect(prisma.auditOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { failedAt: { not: null }, resolvedAt: null },
        orderBy: { failedAt: 'desc' },
        skip: 10,
        take: 10,
      }),
    );
    expect(res.items).toEqual([deadRow]);
    expect(res.total).toBe(1);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
  });

  it('countDeadLetter counts active dead rows', async () => {
    (prisma.auditOutbox.count as Mock).mockResolvedValue(3);
    const n = await audit.countDeadLetter();
    expect(prisma.auditOutbox.count).toHaveBeenCalledWith({
      where: { failedAt: { not: null }, resolvedAt: null },
    });
    expect(n).toBe(3);
  });

  it('retryDeadLetter requeues the row and writes an operator audit', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue(deadRow);
    (prisma.auditOutbox.update as Mock).mockResolvedValue({});
    (prisma.auditLog.create as Mock).mockResolvedValue({ id: 'log-1' });

    await audit.retryDeadLetter('dead-1', { actorId: 'admin-1', actorRole: 'admin' });

    expect(prisma.auditOutbox.update).toHaveBeenCalledWith({
      where: { id: 'dead-1' },
      data: {
        retryCount: 0,
        failedAt: null,
        lastError: null,
        nextRetryAt: expect.any(Date),
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin-1',
          actorRole: 'admin',
          action: 'audit_dead_letter_retry',
          targetType: 'audit_outbox',
          targetId: 'dead-1',
        }),
      }),
    );
  });

  it('retryDeadLetter throws NotFound for an unknown id', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue(null);
    await expect(
      audit.retryDeadLetter('ghost', { actorId: 'a', actorRole: 'admin' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveDeadLetter marks resolved and writes an operator audit', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue(deadRow);
    (prisma.auditOutbox.update as Mock).mockResolvedValue({});
    (prisma.auditLog.create as Mock).mockResolvedValue({ id: 'log-2' });

    await audit.resolveDeadLetter('dead-1', {
      reason: 'duplicate, safe to ignore',
      actorId: 'admin-1',
      actorRole: 'admin',
    });

    expect(prisma.auditOutbox.update).toHaveBeenCalledWith({
      where: { id: 'dead-1' },
      data: {
        resolvedAt: expect.any(Date),
        resolvedBy: 'admin-1',
        resolution: 'duplicate, safe to ignore',
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'audit_dead_letter_resolved',
          targetId: 'dead-1',
        }),
      }),
    );
  });

  it('resolveDeadLetter throws NotFound for an unknown id', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue(null);
    await expect(
      audit.resolveDeadLetter('ghost', { reason: 'x', actorId: 'a', actorRole: 'admin' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveDeadLetter throws BadRequest when the row is not in dead-letter', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue({ ...deadRow, failedAt: null });
    await expect(
      audit.resolveDeadLetter('dead-1', { reason: 'x', actorId: 'a', actorRole: 'admin' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveDeadLetter throws Conflict when already resolved', async () => {
    (prisma.auditOutbox.findUnique as Mock).mockResolvedValue({
      ...deadRow,
      resolvedAt: new Date(),
    });
    await expect(
      audit.resolveDeadLetter('dead-1', { reason: 'x', actorId: 'a', actorRole: 'admin' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
