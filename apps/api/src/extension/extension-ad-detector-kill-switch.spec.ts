import { describe, expect, it, vi } from 'vitest';

import { ExtensionAdTrait } from './extension-ad.trait';

describe('ExtensionAdTrait.requestAd — detector version kill-switch (P1.17)', () => {
  function makeTrait(overrides: Record<string, unknown> = {}) {
    const prisma = {
      device: {
        findUnique: vi.fn(),
      },
      waitStateEvent: {
        findFirst: vi.fn(),
      },
      adImpression: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const compliance = {
      isConsented: vi.fn().mockResolvedValue(false),
    };
    const runtimeConfig = {
      isDetectorVersionEnabled: vi.fn().mockResolvedValue(true),
      isAdsEnabled: vi.fn().mockResolvedValue(true),
      getWaitLaunchMode: vi.fn().mockResolvedValue('earnings_enabled'),
      isCountryAllowed: vi.fn().mockResolvedValue(true),
      getVerifiedDetectorVersions: vi.fn().mockReturnValue(''),
      ...(overrides.runtimeConfig as Record<string, unknown>),
    };
    const { runtimeConfig: _ignored, ...rest } = overrides;
    const trait = new ExtensionAdTrait();
    Object.assign(trait as unknown as Record<string, unknown>, {
      prisma,
      compliance,
      runtimeConfig,
      enforcePrivacyOn: vi.fn(),
      verifyDeviceSignature: vi.fn().mockResolvedValue(true),
      metrics: { increment: vi.fn() } as unknown as Record<string, unknown>,
      logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } as unknown as Record<string, unknown>,
      ...rest,
    });
    return { prisma, compliance, runtimeConfig, trait };
  }

  const baseDto = {
    deviceId: 'd1',
    sessionId: 's1',
    waitStateId: 'ws1',
    toolType: 'cursor',
    idempotencyKey: 'idk1',
    signature: 'sig',
  };

  it('refuses to serve an ad (detector_version_disabled) when the detector version is disabled', async () => {
    const { prisma, compliance, runtimeConfig, trait } = makeTrait({
      runtimeConfig: { isDetectorVersionEnabled: vi.fn().mockResolvedValue(false) },
    });
    prisma.device.findUnique.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      user: { status: 'active' },
    });
    compliance.isConsented.mockResolvedValue(false);
    prisma.waitStateEvent.findFirst.mockResolvedValue({
      detectorVersion: '1.0.0',
    });

    const result = await trait.requestAd('u1', baseDto);

    expect(result).toEqual({ ad: null, reason: 'detector_version_disabled' });
    expect(runtimeConfig.isDetectorVersionEnabled).toHaveBeenCalledWith('1.0.0');
    // The gate returns before the (second) wait-state-end lookup.
    expect(prisma.waitStateEvent.findFirst).toHaveBeenCalledTimes(1);
  });

  it('suppresses the ad surface in ads_only mode before any impression can be created', async () => {
    const { prisma, trait } = makeTrait({
      runtimeConfig: { getWaitLaunchMode: vi.fn().mockResolvedValue('ads_only') },
    });
    prisma.device.findUnique.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      user: { status: 'active' },
    });

    await expect(trait.requestAd('u1', baseDto)).resolves.toEqual({
      ad: null,
      reason: 'earnings_not_available',
      mode: 'ads_only',
    });
    expect(prisma.waitStateEvent.findFirst).not.toHaveBeenCalled();
  });
});
