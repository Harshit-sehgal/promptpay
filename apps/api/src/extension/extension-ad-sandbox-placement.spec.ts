import { describe, expect, it, vi } from 'vitest';

import { ExtensionAdTrait } from './extension-ad.trait';

const WAIT_START = {
  id: 'wait-event-1',
  createdAt: new Date('2026-08-05T12:00:00.000Z'),
  confidence: 0.9,
  isFalsePositive: false,
  detectorVersion: '1.0.0',
  signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
  evidence: [],
};

const CREATIVE = {
  id: 'creative-1',
  title: 'Sandbox test ad',
  sponsoredMessage: 'Test credits only',
  displayDomain: 'sandbox.waitlayer.test',
  destinationUrl: 'https://sandbox.waitlayer.test/ad',
  ctaText: 'Learn more',
};

function makeTrait(environmentKind: string, overrides: Record<string, unknown> = {}) {
  const opportunity = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const adCreative = { findUnique: vi.fn() };
  const campaignPlacement = { findMany: vi.fn() };
  const tx = { adOpportunity: opportunity, adCreative, campaignPlacement };
  const prisma = {
    userSettings: {
      findUnique: vi.fn().mockResolvedValue({ waitTelemetryEnabled: true, adsEnabled: true }),
    },
    device: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'device-1',
        userId: 'user-1',
        user: { status: 'active' },
      }),
    },
    waitStateEvent: {
      findFirst: vi.fn((args: { where?: { eventType?: string } }) =>
        args.where?.eventType === 'wait_state_end' ? null : WAIT_START,
      ),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ country: 'US' }) },
    agentSession: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'session-db-1', userId: 'user-1', deviceId: 'device-1' }),
    },
    adImpression: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const runtimeConfig = {
    getWaitLaunchMode: vi.fn().mockResolvedValue('telemetry_only'),
    getEnvironmentKind: vi.fn().mockReturnValue(environmentKind),
    isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
    isAdsEnabled: vi.fn().mockResolvedValue(true),
    isCountryAllowed: vi.fn().mockResolvedValue(true),
    getVerifiedDetectorVersions: vi.fn().mockReturnValue('1.0.0'),
    ...(overrides.runtimeConfig as Record<string, unknown>),
  };
  const trait = new ExtensionAdTrait();
  Object.assign(trait as unknown as Record<string, unknown>, {
    prisma,
    runtimeConfig,
    compliance: { isConsented: vi.fn().mockResolvedValue(false) },
    audit: { log: vi.fn() },
    metrics: { increment: vi.fn() },
    logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() },
    enforcePrivacyOn: vi.fn(),
    verifyDeviceSignature: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
  return { trait, prisma, runtimeConfig, opportunity, adCreative, campaignPlacement };
}

const request = {
  deviceId: 'device-1',
  sessionId: 'session-1',
  waitStateId: 'wait-1',
  toolType: 'vscode',
  idempotencyKey: 'ad-request-1',
  signature: 'signature',
};

function sandboxPlacement() {
  return {
    bidAmountMinor: 25n,
    minAttentionScore: null,
    minIntegrationScore: null,
    frequencyCapPerHour: null,
    frequencyCapPerDay: null,
    campaign: {
      id: 'sandbox-campaign-1',
      currency: 'XTS',
      category: 'general',
      creatives: [CREATIVE],
    },
  };
}

describe('WL-062 sandbox foreground placement', () => {
  it('claims an unexpired XTS placement without creating a production impression', async () => {
    const { trait, prisma, opportunity, campaignPlacement } = makeTrait('sandbox');
    opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      attentionConfidence: 0.9,
      integrationConfidence: 0.9,
    });
    campaignPlacement.findMany.mockResolvedValue([sandboxPlacement()]);

    const result = await trait.requestAd('user-1', request);

    expect(result).toMatchObject({ mode: 'sandbox', hasCashValue: false });
    expect(result.ad).toMatchObject({
      campaignId: 'sandbox-campaign-1',
      creativeId: 'creative-1',
      label: 'Sponsored · Sandbox',
    });
    expect(opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placementType: 'foreground_wait',
          state: 'candidate',
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
    expect(campaignPlacement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placementType: 'foreground_wait',
          campaign: expect.objectContaining({
            currency: 'XTS',
            status: 'active',
          }),
        }),
      }),
    );
    expect(opportunity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'opportunity-1', state: 'candidate', expiresAt: expect.any(Object) },
        data: expect.objectContaining({
          state: 'rendered',
          claimIdempotencyKey: expect.any(String),
          sandboxImpressionToken: expect.any(String),
        }),
      }),
    );
    expect(prisma.adImpression.findFirst).not.toHaveBeenCalled();
  });

  it('returns a non-cash response for an absent or expired opportunity', async () => {
    const { trait, opportunity, campaignPlacement } = makeTrait('sandbox');
    opportunity.findFirst.mockResolvedValue(null);

    await expect(trait.requestAd('user-1', request)).resolves.toEqual({
      ad: null,
      mode: 'sandbox',
      hasCashValue: false,
      reason: 'no_sandbox_placement',
    });
    expect(campaignPlacement.findMany).not.toHaveBeenCalled();
  });

  it('replays the same response after a first claim without claiming twice', async () => {
    const { trait, opportunity, adCreative, campaignPlacement } = makeTrait('sandbox');
    let claimed = false;
    let claimedToken: string | null = null;
    opportunity.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.claimIdempotencyKey && !claimed) return null;
      if (args.where.state === 'candidate') {
        return claimed
          ? null
          : { id: 'opportunity-1', attentionConfidence: 0.9, integrationConfidence: 0.9 };
      }
      return claimed
        ? {
            id: 'opportunity-1',
            selectedCampaignId: 'sandbox-campaign-1',
            selectedCreativeId: 'creative-1',
            sandboxImpressionToken: claimedToken,
          }
        : null;
    });
    opportunity.updateMany.mockImplementation(
      async (args: { data: { sandboxImpressionToken: string } }) => {
        claimed = true;
        claimedToken = args.data.sandboxImpressionToken;
        return { count: 1 };
      },
    );
    adCreative.findUnique.mockResolvedValue(CREATIVE);
    campaignPlacement.findMany.mockResolvedValue([sandboxPlacement()]);

    const first = await trait.requestAd('user-1', request);
    const replay = await trait.requestAd('user-1', request);

    expect(first.ad?.impressionToken).toBe(replay.ad?.impressionToken);
    expect(opportunity.updateMany).toHaveBeenCalledOnce();
    expect(campaignPlacement.findMany).toHaveBeenCalledOnce();
  });

  it('returns the winner response when a concurrent claim loses its CAS', async () => {
    const { trait, opportunity, adCreative, campaignPlacement } = makeTrait('sandbox');
    opportunity.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.claimIdempotencyKey && !args.where.id) {
        return null;
      }
      if (args.where.state === 'candidate') {
        return { id: 'opportunity-1', attentionConfidence: 0.9, integrationConfidence: 0.9 };
      }
      return {
        id: 'opportunity-1',
        selectedCampaignId: 'sandbox-campaign-1',
        selectedCreativeId: 'creative-1',
        sandboxImpressionToken: 'sandbox-winner-token',
      };
    });
    opportunity.updateMany.mockResolvedValue({ count: 0 });
    adCreative.findUnique.mockResolvedValue(CREATIVE);
    campaignPlacement.findMany.mockResolvedValue([sandboxPlacement()]);

    const result = await trait.requestAd('user-1', request);

    expect(result.ad?.impressionToken).toBe('sandbox-winner-token');
    expect(result.hasCashValue).toBe(false);
  });

  it('keeps telemetry-only behavior and never queries sandbox opportunities outside sandbox', async () => {
    const { trait, opportunity, runtimeConfig } = makeTrait('staging');

    await expect(trait.requestAd('user-1', request)).resolves.toEqual({
      ad: null,
      reason: 'earnings_not_available',
      mode: 'telemetry_only',
    });
    expect(runtimeConfig.getEnvironmentKind).toHaveBeenCalled();
    expect(opportunity.findFirst).not.toHaveBeenCalled();
  });

  it('claims a completion-return candidate through the correlation-id path', async () => {
    const { trait, opportunity, campaignPlacement, prisma } = makeTrait('sandbox');
    opportunity.findFirst.mockResolvedValue({
      id: 'completion-opportunity-1',
      attentionConfidence: 0.9,
      integrationConfidence: 0.9,
    });
    campaignPlacement.findMany.mockResolvedValue([sandboxPlacement()]);

    const result = await trait.requestSandboxPlacement('user-1', {
      deviceId: 'device-1',
      correlationId: 'provider-correlation-1',
      placementType: 'completion_return',
      idempotencyKey: 'completion-request-1',
      signature: 'signature',
    });

    expect(result).toMatchObject({ mode: 'sandbox', hasCashValue: false });
    expect(opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 'session-db-1',
          placementType: 'completion_return',
        }),
      }),
    );
    expect(campaignPlacement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placementType: 'completion_return' }),
      }),
    );
    expect(prisma.agentSession.findUnique).toHaveBeenCalledWith({
      where: { correlationId: 'provider-correlation-1' },
      select: { id: true, userId: true, deviceId: true },
    });
  });

  it('does not claim an opportunity when the user sandbox exposure cap is reached', async () => {
    const { trait, opportunity, campaignPlacement } = makeTrait('sandbox', {
      // The user setting is the authoritative sandbox exposure cap.
    });
    opportunity.count.mockResolvedValue(6);
    opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      attentionConfidence: 0.9,
      integrationConfidence: 0.9,
    });

    const result = await trait.requestAd('user-1', request);

    expect(opportunity.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placementType: 'foreground_wait' }),
      }),
    );
    expect(result).toMatchObject({
      mode: 'sandbox',
      hasCashValue: false,
      reason: 'no_sandbox_placement',
    });
    expect(campaignPlacement.findMany).not.toHaveBeenCalled();
    expect(opportunity.updateMany).not.toHaveBeenCalled();
  });

  it('does not claim an opportunity when the placement has no approved creative', async () => {
    const { trait, opportunity, campaignPlacement } = makeTrait('sandbox');
    opportunity.findFirst.mockResolvedValue({
      id: 'opportunity-1',
      attentionConfidence: 0.9,
      integrationConfidence: 0.9,
    });
    campaignPlacement.findMany.mockResolvedValue([
      { ...sandboxPlacement(), campaign: { ...sandboxPlacement().campaign, creatives: [] } },
    ]);

    const result = await trait.requestAd('user-1', request);

    expect(result).toEqual({
      ad: null,
      mode: 'sandbox',
      hasCashValue: false,
      reason: 'no_sandbox_placement',
    });
    expect(opportunity.updateMany).not.toHaveBeenCalled();
  });
});
