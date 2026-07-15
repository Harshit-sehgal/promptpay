import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { HealthController } from './health.controller';

function databaseProbePrisma(result: 'ok' | 'error') {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw:
      result === 'ok'
        ? vi.fn().mockResolvedValue([{ '?column?': 1 }])
        : vi.fn().mockRejectedValue(new Error('down')),
  };
  return {
    tx,
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
}

describe('HealthController route security', () => {
  it('keeps the liveness endpoint unguarded for infrastructure probes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.check);
    expect(guards).toBeUndefined();
  });

  it('guards operational metrics behind admin JWT roles', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.metrics);
    const roles = Reflect.getMetadata(ROLES_KEY, HealthController.prototype.metrics);

    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(roles).toEqual(['admin', 'super_admin']);
  });
});

describe('HealthController metrics endpoint', () => {
  function metricsPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const prisma = {
      tx,
      $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      payoutRequest: { count: vi.fn().mockResolvedValue(3) },
      fraudFlag: { count: vi.fn().mockResolvedValue(1) },
      user: { count: vi.fn().mockResolvedValue(42) },
      emailQueue: { count: vi.fn().mockResolvedValue(5) },
      webhookEvent: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date(Date.now() - 120_000), // 2 minutes ago
        }),
      },
      adImpression: { count: vi.fn().mockResolvedValue(7) },
      waitStateEvent: { count: vi.fn().mockResolvedValue(100) },
    };
    return prisma;
  }

  it('returns email queue depth, webhook lag, overspend attempts, and wait-detection quality', async () => {
    const prisma = metricsPrisma();
    // Mock wait-detection counts: 100 total, 5 flagged, 10 low-confidence
    prisma.waitStateEvent.count = vi
      .fn()
      .mockResolvedValueOnce(100) // totalWaitStates
      .mockResolvedValueOnce(5) // flaggedFalsePositives
      .mockResolvedValueOnce(10); // lowConfidenceBlocked
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.metrics();

    expect(res.queues).toBeDefined();
    expect((res.queues as Record<string, unknown>).emailQueueDepth).toBe(5);
    expect((res.queues as Record<string, unknown>).webhookStalled).toBe(2);
    expect((res.queues as Record<string, unknown>).webhookLagSeconds).toBeGreaterThanOrEqual(119);

    expect(res.financial).toBeDefined();
    expect((res.financial as Record<string, unknown>).overspendAttempts).toBe(7);

    expect(res.waitDetection).toBeDefined();
    const wait = res.waitDetection as Record<string, number>;
    // highConfidenceTotal = 100 - 10 = 90
    // highConfidenceTruePositives = 90 - 5 = 85
    // precision = 85 / 90 ≈ 0.944...
    expect(wait.precision).toBeGreaterThanOrEqual(0.9);
    // falsePositiveRate = 5 / 100 = 0.05
    expect(wait.falsePositiveRate).toBeLessThanOrEqual(0.05);
    expect(wait.totalWaitStates).toBe(100);
    expect(wait.flaggedFalsePositives).toBe(5);
    expect(wait.lowConfidenceBlocked).toBe(10);
  });

  it('returns zero webhook lag when no pending events exist', async () => {
    const prisma = metricsPrisma();
    prisma.webhookEvent.findFirst.mockResolvedValue(null);
    prisma.waitStateEvent.count = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.metrics();

    expect((res.queues as Record<string, unknown>).webhookLagSeconds).toBe(0);
    const wait = res.waitDetection as Record<string, number>;
    // No wait states → precision defaults to 1, falsePositiveRate to 0
    expect(wait.precision).toBe(1);
    expect(wait.falsePositiveRate).toBe(0);
  });
});

describe('HealthController readiness (A-042)', () => {
  it('returns ok when DB and Redis are healthy', async () => {
    const prisma = databaseProbePrisma('ok');
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.ready();
    expect(res.status).toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2000,
      timeout: 2500,
    });
    expect(prisma.tx.$executeRaw).toHaveBeenCalled();
  });

  it('throws 503 when the database is unreachable', async () => {
    const prisma = databaseProbePrisma('error');
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when Redis is down', async () => {
    const prisma = databaseProbePrisma('ok');
    const redis = { check: vi.fn().mockResolvedValue({ status: 'error' }) };
    const controller = new HealthController(prisma as never, redis as never);

    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });
});
