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

describe('HealthController wait launch mode (A-089)', () => {
  const redisOk = { check: vi.fn().mockResolvedValue('connected') };
  const config = { get: vi.fn((_key: string, fallback?: unknown) => fallback) };

  function controllerWith(runtimeConfig: { getWaitLaunchMode: () => Promise<string> }) {
    return new HealthController(
      databaseProbePrisma('ok') as never,
      redisOk as never,
      runtimeConfig as never,
      config as never,
    );
  }

  it('publishes the launch mode so clients can state settlement status honestly', async () => {
    const controller = controllerWith({
      getWaitLaunchMode: vi.fn().mockResolvedValue('telemetry_only'),
    });

    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      waitLaunchMode: 'telemetry_only',
    });
  });

  it('reports earnings_enabled when settlement is genuinely live', async () => {
    const controller = controllerWith({
      getWaitLaunchMode: vi.fn().mockResolvedValue('earnings_enabled'),
    });

    await expect(controller.check()).resolves.toMatchObject({
      waitLaunchMode: 'earnings_enabled',
    });
  });

  it('degrades to "unknown" rather than failing the liveness probe', async () => {
    // A runtime-config outage must not turn the liveness probe red — an
    // infrastructure probe failing would take the deployment out of rotation
    // over a non-critical disclosure field.
    const controller = controllerWith({
      getWaitLaunchMode: vi.fn().mockRejectedValue(new Error('settings unavailable')),
    });

    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      waitLaunchMode: 'unknown',
    });
  });

  it('never reports earnings_enabled when the mode cannot be resolved', async () => {
    // Fail-closed: the disclosure banner keys off this value, so an unreadable
    // config must never let the product claim it pays people.
    const controller = controllerWith({
      getWaitLaunchMode: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = (await controller.check()) as { waitLaunchMode: string };
    expect(result.waitLaunchMode).not.toBe('earnings_enabled');
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
      waitStateEvent: {
        count: vi.fn().mockResolvedValue(100),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      payoutTransaction: {
        groupBy: vi.fn().mockResolvedValue([{ provider: 'manual', _count: { id: 2 } }]),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          currency: 'USD',
          netAdvertiserSpendMinor: 1000n,
          netEarningsMinor: 600n,
          netPlatformFeeMinor: 300n,
          netReserveMinor: 100n,
          discrepancyMinor: 0n,
        },
      ]),
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
    // falsePositiveRate = 5 / 90 ≈ 0.0556 (measured on the high-confidence population)
    expect(wait.falsePositiveRate).toBeCloseTo(5 / 90, 10);
    expect(wait.totalWaitStates).toBe(100);
    expect(wait.flaggedFalsePositives).toBe(5);
    expect(wait.lowConfidenceBlocked).toBe(10);

    expect(res.ledgerDiscrepancies).toBeDefined();
    const ledgerDiscrepancies = res.ledgerDiscrepancies as {
      discrepancies: Array<Record<string, unknown>>;
      hasDiscrepancy: boolean;
    };
    expect(ledgerDiscrepancies.discrepancies).toHaveLength(1);
    expect(ledgerDiscrepancies.discrepancies[0].currency).toBe('USD');
    expect(ledgerDiscrepancies.discrepancies[0].discrepancyMinor).toBe('0');
    expect(ledgerDiscrepancies.hasDiscrepancy).toBe(false);

    expect(res.providerFailures).toBeDefined();
    expect(res.providerFailures).toEqual({ byProvider: { manual: 2 }, total: 2 });
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

  it('returns a structured error when ledger discrepancy computation fails', async () => {
    const prisma = metricsPrisma();
    prisma.$queryRaw.mockRejectedValue(new Error('ledger query failed'));
    // Wait-detection counts: 0 total, 0 flagged, 0 low-confidence
    prisma.waitStateEvent.count = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.metrics();

    expect(res.ledgerDiscrepancies).toEqual({ error: 'computation_failed' });
    expect(res.providerFailures).toEqual({ byProvider: { manual: 2 }, total: 2 });
  });

  it('returns a structured error when provider failure computation fails', async () => {
    const prisma = metricsPrisma();
    prisma.payoutTransaction.groupBy.mockRejectedValue(new Error('provider query failed'));
    // Wait-detection counts: 0 total, 0 flagged, 0 low-confidence
    prisma.waitStateEvent.count = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const redis = { check: vi.fn().mockResolvedValue({ status: 'connected' }) };
    const controller = new HealthController(prisma as never, redis as never);

    const res = await controller.metrics();

    expect(res.providerFailures).toEqual({ error: 'computation_failed' });
    expect(res.ledgerDiscrepancies).toBeDefined();
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
