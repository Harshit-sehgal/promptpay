import { describe, expect, it, vi } from 'vitest';

import { createMockRuntimeConfig } from '../runtime-config/runtime-config.test-helper';
import { ExtensionService } from './extension.service';

/**
 * P0.1 adversarial tests: a modified client that possesses a valid device secret
 * but forges a single `ai_generation` signal must not be able to earn money.
 *
 * The ad-serving gate (adEligible) intentionally remains permissive so a real
 * wait can be monetized, but the payment gate (paymentEligible) rejects the
 * impression/click qualification when the wait state lacks corroborating
 * primary signals.
 */

function makeImpression(bidType: 'cpm' | 'cpc' = 'cpm') {
  return {
    id: 'imp-1',
    userId: 'user-1',
    deviceId: 'dev-1',
    campaignId: 'camp-1',
    impressionTokenHash: 'hash-1',
    renderedAt: new Date(Date.now() - 10_000),
    qualifiedAt: null,
    waitStateId: 'ws-1',
    sessionId: 'sess-1',
    campaign: {
      id: 'camp-1',
      bidAmountMinor: 100,
      currency: 'USD',
      advertiserId: 'adv-1',
      bidType,
    },
    user: { status: 'active' },
  };
}

function makePrisma() {
  const prisma: any = {
    adImpression: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      update: vi.fn(async (args: any) => args.data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    waitStateEvent: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ws-1',
        signals: [{ type: 'ai_generation' }],
        detectorVersion: '1.0.0',
      }),
    },
    adClick: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    adCreative: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'creative-1',
        destinationUrl: 'https://example.com/ad',
      }),
    },
    trustScore: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn(async () => 1),
    $executeRawUnsafe: vi.fn(async () => 1),
  };

  // Minimal in-memory transaction mock; the test path only reads/writes through
  // the same objects, so a synchronous callback is enough.
  prisma.$transaction = vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prisma));

  return prisma;
}

describe('Adversarial wait qualification (P0.1)', () => {
  it('releases a CPM reservation rather than settling client-only wait evidence by default', async () => {
    const prisma = makePrisma();
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression('cpm'));

    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      { checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }) } as any,
      {} as any,
      {} as any,
      createMockRuntimeConfig({ isWaitEarningsEnabled: vi.fn().mockResolvedValue(false) }),
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-disabled',
      signature: 'sig',
    });

    expect(result).toMatchObject({ qualified: false, reason: 'wait_earnings_disabled' });
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invalidationReason: 'wait_earnings_disabled' }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects a CPM qualification for a single forged ai_generation signal', async () => {
    const prisma = makePrisma();
    prisma.adImpression.findUnique.mockResolvedValue(makeImpression('cpm'));

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
      createMockRuntimeConfig({
        getVerifiedDetectorVersions: vi.fn().mockReturnValue('1.0.0'),
      }),
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    const result = await service.recordQualifiedImpression('user-1', {
      impressionToken: 'tok-1',
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs: 10_000,
      idempotencyKey: 'idem-1',
      signature: 'sig',
    });

    expect(result.qualified).toBe(false);
    expect(result.reason).toBe('uncorroborated_wait');
    // The impression should be invalidated so it cannot be re-qualified.
    expect(prisma.adImpression.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invalidationReason: 'uncorroborated_wait' }),
      }),
    );
  });

  it('rejects a CPC click for a single forged ai_generation signal', async () => {
    const prisma = makePrisma();
    prisma.adImpression.findUnique.mockResolvedValue({
      ...makeImpression('cpc'),
      qualifiedAt: new Date(),
      adClick: [],
    });

    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {
        calculateSplit: vi.fn(() => ({ userShare: 70n, platformShare: 20n, reserveShare: 10n })),
        getHoldDays: vi.fn(() => 7),
      } as any,
      {
        checkImpressionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
        checkClickPatterns: vi.fn().mockResolvedValue({ allowed: true }),
        checkSelfClick: vi.fn().mockResolvedValue({ allowed: true }),
        checkRepeatedClickAbuse: vi.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {} as any,
      createMockRuntimeConfig({
        getVerifiedDetectorVersions: vi.fn().mockReturnValue('1.0.0'),
      }),
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    const result = await service.recordClick('user-1', {
      impressionToken: 'tok-1',
      clickedAt: new Date().toISOString(),
      idempotencyKey: 'idem-click-1',
      signature: 'sig',
    });

    expect(result.clicked).toBe(false);
    expect(result.reason).toBe('uncorroborated_wait');
    // No click should be created and no click-side transaction should run.
    expect(prisma.adClick.findUnique).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not bill a previously qualified CPC impression after settlement is disabled', async () => {
    const prisma = makePrisma();
    prisma.adImpression.findUnique.mockResolvedValue({
      ...makeImpression('cpc'),
      qualifiedAt: new Date(),
      adClick: [],
    });

    const service = new ExtensionService(
      prisma,
      { log: vi.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      createMockRuntimeConfig({ isWaitEarningsEnabled: vi.fn().mockResolvedValue(false) }),
    );
    (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);

    const result = await service.recordClick('user-1', {
      impressionToken: 'tok-1',
      clickedAt: new Date().toISOString(),
      idempotencyKey: 'idem-legacy-disabled',
      signature: 'sig',
    });

    expect(result).toMatchObject({ clicked: false, reason: 'wait_earnings_disabled' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
