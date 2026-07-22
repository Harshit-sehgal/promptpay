import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';

import { createMockRuntimeConfig } from '../runtime-config/runtime-config.test-helper';
import { ExtensionService } from './extension.service';
import { MINIMUM_WAIT_CONFIDENCE } from './extension-wait.trait';

/**
 * Unit tests for the durable distributed idempotency added to requestAd.
 * These prove that replaying the same idempotency key returns the original
 * ad, a mismatched replay is rejected with 409, and a failing non-blocking
 * fraud signal is observable rather than silently swallowed.
 */

// Confidence is now imported from the real threshold so the test stays in sync.

function makeWaitStart(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-evt-1',
    createdAt: new Date(Date.now() - 60_000),
    confidence: MINIMUM_WAIT_CONFIDENCE,
    isFalsePositive: false,
    detectorVersion: '1.0.0',
    signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
    evidence: [],
    ...overrides,
  };
}

function makePrisma(existingImpression: Record<string, unknown> | null = null) {
  const impression = existingImpression;
  const prisma: any = {
    device: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'dev-1',
        userId: 'user-1',
        user: { status: 'active' },
        eventSecret: 'secret',
      }),
    },
    waitStateEvent: {
      findFirst: vi.fn(async (args: { where?: { eventType?: string } }) => {
        if (args.where?.eventType === 'wait_state_end') return null;
        return makeWaitStart();
      }),
    },
    adImpression: {
      findFirst: vi.fn().mockResolvedValue(impression),
      findMany: vi.fn().mockResolvedValue([]),
    },
    userSettings: {
      findUnique: vi.fn().mockResolvedValue({
        blockedCategories: [],
        adsEnabled: true,
        waitTelemetryEnabled: true,
        quietMode: false,
        timezone: 'UTC',
      }),
    },
    waitAttestationSession: { findFirst: vi.fn().mockResolvedValue({ id: 'attestation-session-1' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ country: null }) },
    campaign: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return prisma;
}

function makeService(prisma: any) {
  const service = new ExtensionService(
    prisma,
    { log: vi.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any,
    { isConsented: vi.fn().mockResolvedValue(false) } as any,
    {} as any,
    createMockRuntimeConfig({
      getVerifiedDetectorVersions: vi.fn().mockReturnValue('1.0.0'),
      isAdsEnabled: vi.fn().mockResolvedValue(true),
      isCountryAllowed: vi.fn().mockResolvedValue(true),
      isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
    }),
  );
  (service as any).verifyDeviceSignature = vi.fn().mockResolvedValue(true);
  // Prevent the auction from running; the durable path returns before this.
  (service as any).auctionService = {
    selectEligibleCampaign: vi.fn().mockResolvedValue([]),
    runAuction: vi.fn().mockRejectedValue(new Error('auction should not run')),
  };
  return service;
}

const baseDto = {
  deviceId: 'dev-1',
  sessionId: 'sess-1',
  waitStateId: 'ws-1',
  toolType: 'vscode',
  idempotencyKey: 'idem-1',
  signature: 'sig',
};

describe('ExtensionAdTrait durable idempotency (P1)', () => {
  it('returns the original ServedAd when the same idempotency key is reused with the same request', async () => {
    const ad = {
      impressionToken: 'token-1',
      campaignId: 'camp-1',
      creativeId: 'creative-1',
      title: 'Ad',
      message: 'Sponsored',
      label: 'Sponsored',
      displayDomain: 'example.com',
      destinationUrl: 'https://example.com',
      ctaText: null,
    };
    const prisma = makePrisma({
      id: 'imp-1',
      userId: 'user-1',
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      waitStateId: 'ws-1',
      idempotencyKey: 'idem-1',
      campaignId: 'camp-1',
      creativeId: 'creative-1',
      impressionToken: 'token-1',
      creative: {
        id: 'creative-1',
        title: 'Ad',
        sponsoredMessage: 'Sponsored',
        displayDomain: 'example.com',
        destinationUrl: 'https://example.com',
        ctaText: null,
      },
      campaign: { id: 'camp-1' },
    });
    const service = makeService(prisma);

    const result = await service.requestAd('user-1', baseDto);

    expect(result).toEqual({ ad });
    // Auction must not run when a durable response is returned.
    expect((service as any).auctionService.selectEligibleCampaign).not.toHaveBeenCalled();
  });

  it('throws 409 when the same idempotency key is used with a different request', async () => {
    const prisma = makePrisma({
      id: 'imp-1',
      userId: 'user-1',
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      waitStateId: 'ws-1',
      idempotencyKey: 'idem-1',
      campaignId: 'camp-1',
      creativeId: 'creative-1',
      impressionToken: 'token-1',
      creative: {
        id: 'creative-1',
        title: 'Ad',
        sponsoredMessage: '',
        displayDomain: '',
        destinationUrl: '',
        ctaText: null,
      },
      campaign: { id: 'camp-1' },
    });
    const service = makeService(prisma);

    await expect(service.requestAd('user-1', { ...baseDto, waitStateId: 'ws-2' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws 409 when the same waitStateId is served with a different idempotency key', async () => {
    const prisma = makePrisma({
      id: 'imp-1',
      userId: 'user-1',
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      waitStateId: 'ws-1',
      idempotencyKey: 'idem-original',
      campaignId: 'camp-1',
      creativeId: 'creative-1',
      impressionToken: 'token-1',
      creative: {
        id: 'creative-1',
        title: 'Ad',
        sponsoredMessage: '',
        displayDomain: '',
        destinationUrl: '',
        ctaText: null,
      },
      campaign: { id: 'camp-1' },
    });
    const service = makeService(prisma);

    await expect(
      service.requestAd('user-1', { ...baseDto, idempotencyKey: 'idem-replay' }),
    ).rejects.toThrow(ConflictException);
  });

  it('falls through to a fresh ad serve when a legacy impression has no stored token', async () => {
    const prisma = makePrisma({
      id: 'imp-1',
      userId: 'user-1',
      deviceId: 'dev-1',
      sessionId: 'sess-1',
      waitStateId: 'ws-1',
      idempotencyKey: 'idem-1',
      campaignId: 'camp-1',
      creativeId: 'creative-1',
      impressionToken: null,
      creative: {
        id: 'creative-1',
        title: 'Ad',
        sponsoredMessage: '',
        displayDomain: '',
        destinationUrl: '',
        ctaText: null,
      },
      campaign: { id: 'camp-1' },
    });
    const service = makeService(prisma);

    const result = await service.requestAd('user-1', baseDto);

    // No durable response; auction runs and returns no eligible campaign.
    expect(result).toEqual({ ad: null, reason: 'no_eligible_campaign' });
    expect((service as any).auctionService.selectEligibleCampaign).toHaveBeenCalled();
  });
});

describe('ExtensionAdTrait nonBlocking fraud signal observability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a warning and increments a metric when a non-blocking fraud signal rejects', async () => {
    const prisma = makePrisma(null);
    const metrics = { increment: vi.fn() };
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
    const service = makeService(prisma);
    (service as any).metrics = metrics;
    (service as any).logger = logger;
    (service as any).fraud = {
      checkCountryDeviceChange: vi.fn().mockRejectedValue(new Error('fraud service down')),
    };

    await service.requestAd('user-1', baseDto);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'checkCountryDeviceChange', error: 'fraud service down' }),
      'Non-blocking fraud signal failed',
    );
    expect(metrics.increment).toHaveBeenCalledWith(
      'fraud_signal_error{label=checkCountryDeviceChange}',
    );
  });
});
