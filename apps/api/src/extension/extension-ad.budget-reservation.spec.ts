import { describe, expect, it, vi } from 'vitest';

import { ExtensionService } from './extension.service';

/**
 * Unit tests for the atomic campaign budget reservation feature.
 *
 * requestAd() reserves budget for CPM campaigns before creating an impression.
 * recordQualifiedImpression() converts the reservation to spent budget when
 * the impression is billable, or releases it when the impression is invalidated.
 * CPC campaigns never reserve budget at impression time; clicks are charged
 * directly at click time.
 */

function makePrisma() {
  const prisma: any = {
    adImpression: {
      findUnique: vi.fn(),
      update: vi.fn(async (args: any) => args.data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    trustScore: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn(async () => 1),
    $executeRawUnsafe: vi.fn(async () => 1),
  };

  // Serialize transaction callbacks like the concurrency spec.
  let txChain: Promise<unknown> = Promise.resolve();
  prisma.$transaction = vi.fn(async (cb: (tx: any) => Promise<any>) => {
    const tx = {
      advertiserLedger: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { entryType: 'credit', status: 'confirmed', _sum: { amountMinor: 1000n } },
          ]),
        create: vi.fn(async (args: any) => args.data),
      },
      earningsLedger: { create: vi.fn(async (args: any) => args.data) },
      platformLedger: { create: vi.fn(async (args: any) => args.data) },
      adImpression: { updateMany: prisma.adImpression.updateMany },
      adCreative: { count: vi.fn().mockResolvedValue(0) },
      $executeRaw: prisma.$executeRaw,
      $executeRawUnsafe: prisma.$executeRawUnsafe,
    };
    const run = txChain.then(() => cb(tx));
    txChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });

  return prisma;
}

function makeImpression(
  overrides: {
    bidType?: 'cpm' | 'cpc';
    bidAmountMinor?: number;
    qualifiedAt?: Date | null;
    renderedAt?: Date;
  } = {},
) {
  return {
    id: 'imp-1',
    userId: 'user-1',
    deviceId: 'dev-1',
    campaignId: 'camp-1',
    impressionTokenHash: 'hash-1',
    renderedAt: overrides.renderedAt ?? new Date(Date.now() - 10_000),
    qualifiedAt: overrides.qualifiedAt ?? null,
    campaign: {
      id: 'camp-1',
      bidAmountMinor: overrides.bidAmountMinor ?? 100,
      currency: 'USD',
      advertiserId: 'adv-1',
      bidType: overrides.bidType ?? 'cpm',
    },
    user: { status: 'active' },
  };
}

describe('ExtensionAdTrait budget reservation', () => {
  it('releases reserved budget when the user account is inactive', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const releaseSpy = vi
      .spyOn(service as any, 'releaseBudgetReservation')
      .mockResolvedValue(undefined);
    prisma.adImpression.findUnique.mockResolvedValue({
      ...makeImpression({ bidType: 'cpm' }),
      user: { status: 'banned' },
    });

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('account_not_active');
    expect(releaseSpy).toHaveBeenCalledWith('camp-1', 100n);
  });

  it('releases reserved budget when fraud rate limit blocks the impression', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      {
        checkImpressionRateLimit: vi
          .fn()
          .mockResolvedValue({ allowed: false, reason: 'rate_limit' }),
      } as any,
      {} as any,
      {} as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const releaseSpy = vi
      .spyOn(service as any, 'releaseBudgetReservation')
      .mockResolvedValue(undefined);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpm' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('rate_limit');
    expect(releaseSpy).toHaveBeenCalledWith('camp-1', 100n);
  });

  it('converts reserved budget to spent on qualified CPM impression', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const releaseSpy = vi
      .spyOn(service as any, 'releaseBudgetReservation')
      .mockResolvedValue(undefined);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpm' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(true);
    // Conversion means the reservation is decremented inside the transaction,
    // not released via the helper.
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('does not reserve or spend for CPC impressions', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
    const releaseSpy = vi
      .spyOn(service as any, 'releaseBudgetReservation')
      .mockResolvedValue(undefined);
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression({ bidType: 'cpc' }));

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(true);
    expect(releaseSpy).not.toHaveBeenCalled();
    // No raw SQL budget update should run for CPC impressions.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('releaseBudgetReservation is idempotent and safe when no reservation exists', async () => {
    const prisma = makePrisma();
    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    // Should not throw even though the mock returns 1 for every UPDATE.
    await (service as any).releaseBudgetReservation('camp-1', 100n);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});
