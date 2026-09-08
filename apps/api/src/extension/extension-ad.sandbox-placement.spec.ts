import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { createMockRuntimeConfig } from '../runtime-config/runtime-config.test-helper';
import { ExtensionService } from './extension.service';

// WL-G007 / WL-062 / WL-063: the sandbox opportunity + placement path serves
// non-cash XTS placements (mode: 'sandbox', hasCashValue: false) without ever
// weakening the production settlement gates or writing billing rows. The path
// is reachable ONLY on an explicitly sandbox deployment.

const VERIFIED_DETECTOR_VERSION = '1.0.0';
const userId = 'sandbox-user';
const deviceId = '00000000-0000-4000-8000-000000000201';

const creative = {
  id: 'sandbox-creative',
  status: 'approved',
  title: 'Sandbox test ad',
  sponsoredMessage: 'Test credits only',
  displayDomain: 'sandbox.ateva.test',
  destinationUrl: 'https://sandbox.ateva.test/ad',
  ctaText: 'Learn more',
};

const makePlacement = () => ({
  id: 'sandbox-placement',
  bidAmountMinor: 25n,
  minAttentionScore: null,
  minIntegrationScore: null,
  frequencyCapPerHour: null,
  frequencyCapPerDay: null,
  campaign: {
    id: 'sandbox-campaign',
    currency: 'XTS',
    status: 'active',
    category: 'general',
    creatives: [creative],
  },
});

function buildService(
  options: {
    environmentKind?: string;
    platformAdsEnabled?: boolean;
    countryAllowed?: boolean;
    exposureCount?: number;
    telemetryEnabled?: boolean;
    candidateOpportunity?: unknown;
    placementList?: unknown[];
  } = {},
) {
  const {
    environmentKind = 'sandbox',
    platformAdsEnabled = true,
    countryAllowed = true,
    exposureCount = 0,
    telemetryEnabled = true,
    candidateOpportunity = {
      id: 'sandbox-opportunity',
      attentionConfidence: 0.9,
      integrationConfidence: 0.9,
    },
    placementList = [makePlacement()],
  } = options;
  const audit = { log: vi.fn(async () => undefined) };
  const prisma: Record<string, unknown> = {
    userSettings: {
      findUnique: vi.fn(async () => ({
        waitTelemetryEnabled: telemetryEnabled,
        adsEnabled: true,
        maxAdsPerHour: 6,
        blockedCategories: [],
      })),
    },
    device: {
      findUnique: vi.fn(async () => ({ id: deviceId, userId, user: { status: 'active' } })),
    },
    user: { findUnique: vi.fn(async () => ({ country: 'US' })) },
    waitStateEvent: {
      findFirst: vi.fn(async ({ where }: { where?: { eventType?: string } }) =>
        where?.eventType === 'wait_state_end'
          ? null
          : {
              id: 'sandbox-wait-start',
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
              confidence: 0.9,
              isFalsePositive: false,
              detectorVersion: VERIFIED_DETECTOR_VERSION,
              signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
              evidence: [],
            },
      ),
    },
    waitAttestationSession: { findFirst: vi.fn(async () => ({ id: 'sandbox-attestation' })) },
    adImpression: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    adOpportunity: {
      findFirst: vi.fn(async () => candidateOpportunity),
      count: vi.fn(async () => exposureCount),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    adCreative: { findUnique: vi.fn(async () => creative) },
    campaignPlacement: { findMany: vi.fn(async () => placementList) },
    // The sandbox claim runs the account exposure cap and the CAS write inside
    // one transaction behind a per-user advisory lock, so the mock has to
    // provide both. The callback receives the same client, which is what the
    // real serializable path sees for these two statements.
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(prisma)),
  };
  const runtimeConfig = createMockRuntimeConfig({
    // telemetry_only keeps the non-sandbox production path from reaching the
    // auction (which is not mocked here).
    getWaitLaunchMode: vi.fn().mockResolvedValue('telemetry_only'),
    getEnvironmentKind: vi.fn().mockReturnValue(environmentKind),
    isAdsEnabled: vi.fn().mockResolvedValue(platformAdsEnabled),
    isCountryAllowed: vi.fn().mockResolvedValue(countryAllowed),
    getVerifiedDetectorVersions: vi.fn().mockReturnValue(VERIFIED_DETECTOR_VERSION),
  });
  const service = new ExtensionService(
    prisma as never,
    audit as never,
    {} as never,
    {} as never,
    { isConsented: vi.fn(async () => false) } as never,
    {} as never,
    runtimeConfig,
  );
  vi.spyOn(service as never, 'verifyDeviceSignature').mockResolvedValue(true);
  return { service, prisma, audit };
}

const request = {
  deviceId,
  sessionId: 'sandbox-session',
  waitStateId: 'sandbox-wait',
  toolType: 'cli',
  idempotencyKey: 'sandbox-request',
  signature: 'sandbox-signature',
};

describe('ExtensionService sandbox placement serving (WL-G007/WL-062/WL-063)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('serves a foreground sandbox placement marked mode sandbox, hasCashValue false', async () => {
    const { service, prisma, audit } = buildService();
    const result = await service.requestAd(userId, request);
    expect(result.mode).toBe('sandbox');
    expect(result.hasCashValue).toBe(false);
    expect(result.ad?.title).toBe('Sandbox test ad');
    expect(result.ad?.impressionToken).toBeTruthy();
    // Claimed via a CAS update on the candidate opportunity.
    expect(prisma.adOpportunity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'sandbox-opportunity', state: 'candidate' }),
        data: expect.objectContaining({
          claimIdempotencyKey: 'sandbox-request',
          selectedCampaignId: 'sandbox-campaign',
          sandboxImpressionToken: expect.any(String),
        }),
      }),
    );
    // Only XTS house/test placements are considered.
    expect(prisma.campaignPlacement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placementType: 'foreground_wait',
          isActive: true,
          campaign: expect.objectContaining({ currency: 'XTS', status: 'active' }),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sandbox_opportunity_served' }),
    );
  });

  it('serves a completion-return placement through requestSandboxPlacement', async () => {
    const { service, prisma } = buildService();
    const result = await service.requestSandboxPlacement(userId, {
      deviceId,
      correlationId: 'sandbox-correlation',
      placementType: 'completion_return',
      idempotencyKey: 'sandbox-completion',
      signature: 'sandbox-signature',
    });
    expect(result.mode).toBe('sandbox');
    expect(result.hasCashValue).toBe(false);
    expect(result.ad?.impressionToken).toBeTruthy();
    expect(prisma.campaignPlacement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placementType: 'completion_return' }),
      }),
    );
  });

  it('replays the same token for a repeated idempotency key', async () => {
    const { service, prisma } = buildService();
    prisma.adOpportunity.findFirst.mockImplementation(async ({ where }: { where?: unknown }) => {
      if ((where as { claimIdempotencyKey?: string } | undefined)?.claimIdempotencyKey) {
        return {
          id: 'sandbox-opportunity',
          selectedCampaignId: 'sandbox-campaign',
          selectedCreativeId: 'sandbox-creative',
          sandboxImpressionToken: 'replay-token',
        };
      }
      return { id: 'sandbox-opportunity', attentionConfidence: 0.9, integrationConfidence: 0.9 };
    });
    const result = await service.requestAd(userId, request);
    expect(result.mode).toBe('sandbox');
    expect(result.ad?.impressionToken).toBe('replay-token');
    expect(prisma.adOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it('returns no_sandbox_placement when no candidate opportunity exists (expiry)', async () => {
    const { service } = buildService({ candidateOpportunity: null });
    const result = await service.requestAd(userId, request);
    expect(result).toEqual({
      ad: null,
      reason: 'no_sandbox_placement',
      mode: 'sandbox',
      hasCashValue: false,
    });
  });

  it('returns no_sandbox_placement when category blocking removes every placement', async () => {
    const { service } = buildService({ placementList: [] });
    const result = await service.requestAd(userId, request);
    expect(result.ad).toBeNull();
    expect(result.reason).toBe('no_sandbox_placement');
    expect(result.hasCashValue).toBe(false);
  });

  it('fails closed with country_blocked when the country is disallowed', async () => {
    const { service } = buildService({ countryAllowed: false });
    const result = await service.requestAd(userId, request);
    expect(result).toEqual({
      ad: null,
      reason: 'country_blocked',
      mode: 'sandbox',
      hasCashValue: false,
    });
  });

  it('applies the hourly exposure cap to sandbox placements', async () => {
    const { service } = buildService({ exposureCount: 6 });
    const result = await service.requestAd(userId, request);
    expect(result).toEqual({
      ad: null,
      // Distinct from `no_sandbox_placement`: the account had inventory and
      // spent its attention budget, which is a different thing from having no
      // eligible placement, and support/telemetry need to tell them apart.
      reason: 'account_attention_cap_reached',
      mode: 'sandbox',
      hasCashValue: false,
    });
  });

  it('counts the exposure cap across ALL of an account devices, not per device', async () => {
    // One account has one shared attention inventory. A second machine says
    // WHERE attention happened; it must never increase HOW MUCH the account
    // has to sell, or `installations x attention` becomes the economic
    // primitive and running extra clients becomes a way to earn more.
    const { service, prisma } = buildService();
    await service.requestAd(userId, request);

    expect(prisma.adOpportunity.count).toHaveBeenCalledWith({
      where: {
        userId,
        state: 'claimed',
        claimedAt: { gte: expect.any(Date) },
      },
    });
    const countArgs = prisma.adOpportunity.count.mock.calls[0][0];
    expect(countArgs.where).not.toHaveProperty('deviceId');
  });

  it('serializes the cap check and the claim behind a per-user advisory lock', async () => {
    // Dropping deviceId from the predicate without serializing would swap a
    // per-device over-serve for a concurrent one: two devices both read
    // maxPerHour - 1 and both consume the final slot. This is issue A-061 in a
    // second location, so it takes A-061's remedy.
    const { service, prisma } = buildService();
    await service.requestAd(userId, request);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const lockSql = prisma.$executeRaw.mock.calls[0][0];
    expect(lockSql.join('?')).toContain('pg_advisory_xact_lock');
    // The count must happen inside the transaction, after the lock.
    expect(prisma.adOpportunity.count).toHaveBeenCalled();
  });

  it('does not claim the opportunity when the account cap is already spent', async () => {
    const { service, prisma } = buildService({ exposureCount: 6 });
    await service.requestAd(userId, request);

    expect(prisma.adOpportunity.updateMany).not.toHaveBeenCalled();
  });

  it('honors the platform ad kill-switch for sandbox serving', async () => {
    const { service } = buildService({ platformAdsEnabled: false });
    const result = await service.requestAd(userId, request);
    expect(result).toEqual({
      ad: null,
      reason: 'platform_ads_paused',
      mode: 'sandbox',
      hasCashValue: false,
    });
  });

  it('still requires telemetry consent before serving sandbox placements', async () => {
    const { service } = buildService({ telemetryEnabled: false });
    await expect(service.requestAd(userId, request)).rejects.toThrow(
      new ForbiddenException('wait_telemetry_consent_required'),
    );
  });

  it('rejects unknown placement types before querying opportunities', async () => {
    const { service, prisma } = buildService();
    const result = await service.requestSandboxPlacement(userId, {
      deviceId,
      correlationId: 'sandbox-invalid-placement',
      placementType: 'unknown-placement',
      idempotencyKey: 'sandbox-invalid-placement',
      signature: 'sandbox-signature',
    });
    expect(result).toEqual({
      ad: null,
      reason: 'no_sandbox_placement',
      mode: 'sandbox',
      hasCashValue: false,
    });
    expect(prisma.adOpportunity.findFirst).not.toHaveBeenCalled();
    expect(prisma.campaignPlacement.findMany).not.toHaveBeenCalled();
  });

  it('rejects direct sandbox placement requests outside a sandbox environment', async () => {
    const { service, prisma } = buildService({ environmentKind: 'development' });
    const result = await service.requestSandboxPlacement(userId, {
      deviceId,
      correlationId: 'sandbox-non-sandbox',
      placementType: 'foreground_wait',
      idempotencyKey: 'sandbox-non-sandbox',
      signature: 'sandbox-signature',
    });
    expect(result).toEqual({
      ad: null,
      reason: 'sandbox_unavailable',
      mode: 'sandbox',
      hasCashValue: false,
    });
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
    expect(prisma.adOpportunity.findFirst).not.toHaveBeenCalled();
    expect(prisma.campaignPlacement.findMany).not.toHaveBeenCalled();
  });

  it('never enters the sandbox path outside a sandbox environment', async () => {
    const { service, prisma } = buildService({ environmentKind: 'development' });
    const result = await service.requestAd(userId, request);
    expect(result.ad).toBeNull();
    expect(result.reason).toBe('earnings_not_available');
    expect(prisma.adOpportunity.findFirst).not.toHaveBeenCalled();
    expect(prisma.campaignPlacement.findMany).not.toHaveBeenCalled();
  });
});
