import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRuntimeConfig } from '../runtime-config/runtime-config.test-helper';
import { ExtensionService } from './extension.service';

const VERIFIED_DETECTOR_VERSION = '1.0.0';

// Pure-logic adversarial tests for the requestAd selection path:
//   #1 — mixed-currency campaigns are never compared by raw bidAmountMinor
//   #2 — a campaign lacking enough remaining budget is skipped and the next
//        viable candidate is tried (reservation-loss retry).

vi.mock('../common/utils/advertiser-balance', () => ({
  getAdvertiserBalance: vi.fn(),
  getAdvertiserBalancesByCurrency: vi.fn(async () => new Map([['adv-1:USD', 1_000_000n]])),
}));

vi.mock('./country-targeting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./country-targeting')>()),
  isCountryEligible: vi.fn(() => true),
}));

const makeCreative = (id: string) => ({
  id,
  status: 'approved' as const,
  destinationUrl: 'https://example.com/ad',
  displayDomain: 'example.com',
  title: 'Title',
  sponsoredMessage: 'Message',
  ctaText: null,
});

const makeCampaign = (over: Partial<Record<string, any>> & { id: string }) => ({
  advertiserId: 'adv-1',
  bidType: 'cpm',
  bidAmountMinor: 100n,
  budgetSpentMinor: 0n,
  budgetReservedMinor: 0n,
  budgetTotalMinor: 1000n,
  frequencyCapPerHour: 0,
  frequencyCapPerDay: 0,
  category: 'dev',
  creatives: [makeCreative(`cr-${over.id}`)],
  countryTargeting: [],
  currency: 'USD',
  ...over,
});

function buildService(prismaMock: any, claimImpl: any) {
  const audit = { log: vi.fn() } as any;
  const ledger = {} as any;
  const fraud = {} as any;
  const compliance = { isConsented: vi.fn(async () => false) } as any;
  const googleVerifier = {} as any;
  const runtimeConfig = createMockRuntimeConfig({
    getVerifiedDetectorVersions: vi.fn().mockReturnValue(VERIFIED_DETECTOR_VERSION),
  });
  const service = new ExtensionService(
    prismaMock,
    audit,
    ledger,
    fraud,
    compliance,
    googleVerifier,
    runtimeConfig,
  );
  vi.spyOn(service as any, 'verifyDeviceSignature').mockResolvedValue(true);
  vi.spyOn(service as any, 'recentBillableCampaignIds').mockResolvedValue([]);
  const claimSpy = vi.spyOn(service as any, 'claimImpression').mockImplementation(claimImpl);
  return { service, claimSpy };
}

function basePrisma(campaigns: any[]) {
  return {
    device: {
      findUnique: vi.fn(async () => ({
        id: 'dev-1',
        userId: 'user-1',
        user: { status: 'active' },
        eventSecret: 'secret',
      })),
    },
    waitStateEvent: {
      findFirst: vi.fn(async (args: any) =>
        args.where.eventType === 'wait_state_start'
          ? {
              id: 'ws-evt',
              createdAt: new Date(),
              signals: [{ type: 'ai_generation' }, { type: 'active_task' }],
              detectorVersion: VERIFIED_DETECTOR_VERSION,
            }
          : null,
      ),
    },
    userSettings: {
      findUnique: vi.fn(async () => ({
        blockedCategories: [],
        adsEnabled: true,
        quietMode: false,
        timezone: 'UTC',
      })),
    },
    user: { findUnique: vi.fn(async () => ({ country: null })) },
    adImpression: { findMany: vi.fn(async () => []) },
    campaign: { findMany: vi.fn(async () => campaigns) },
  } as any;
}

const baseDto = {
  deviceId: 'dev-1',
  sessionId: 'sess-1',
  waitStateId: 'ws-1',
  toolType: 'vscode',
  idempotencyKey: 'idem-1',
  signature: 'sig',
  country: undefined,
  allowedCategories: undefined,
  blockedCategories: undefined,
};

describe('requestAd — incomplete-budget fallback (#2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a campaign that has remaining budget but NOT enough for its next charge', async () => {
    // budget 1000, already spent 100 → remaining 900, but bid is 1000.
    // 100 + 0 + 1000 > 1000 → excluded by the pre-charge budget filter.
    const low = makeCampaign({
      id: 'low',
      bidAmountMinor: 1000n,
      budgetTotalMinor: 1000n,
      budgetSpentMinor: 100n,
    });
    const prisma = basePrisma([low]);
    const { service, claimSpy } = buildService(prisma, async () => ({
      status: 'claimed',
      impressionId: 'imp-1',
    }));
    const res = await service.requestAd('user-1', baseDto);
    expect(res.ad).toBeNull();
    expect(res.reason).toBe('no_eligible_campaign');
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it('retries with the next candidate when the winner loses the CPM reservation race', async () => {
    // Two viable campaigns. The first selected loses the reservation
    // (budget_unavailable); selection must remove it and try the second,
    // rather than returning no_eligible_campaign.
    const a = makeCampaign({ id: 'camp-a', bidAmountMinor: 100n, budgetTotalMinor: 1000n });
    const b = makeCampaign({ id: 'camp-b', bidAmountMinor: 90n, budgetTotalMinor: 1000n });
    const prisma = basePrisma([a, b]);
    let firstWon = false;
    const { service, claimSpy } = buildService(prisma, async (args: any) => {
      if (!firstWon && args.campaignId === 'camp-a') {
        firstWon = true;
        return { status: 'budget_unavailable' };
      }
      return { status: 'claimed', impressionId: 'imp-1' };
    });
    const res = await service.requestAd('user-1', baseDto);
    expect(res.ad).not.toBeNull();
    // The fallback campaign must have been claimed.
    expect(claimSpy.mock.calls.some((c) => c[0].campaignId === 'camp-b')).toBe(true);
  });

  it('returns no_eligible_campaign only after every candidate loses reservation', async () => {
    const a = makeCampaign({ id: 'camp-a' });
    const b = makeCampaign({ id: 'camp-b' });
    const prisma = basePrisma([a, b]);
    let count = 0;
    const { service, claimSpy } = buildService(prisma, async () => {
      count++;
      return { status: 'budget_unavailable' };
    });
    const res = await service.requestAd('user-1', baseDto);
    expect(res.ad).toBeNull();
    expect(res.reason).toBe('no_eligible_campaign');
    // Bounded — never loops beyond the number of eligible candidates.
    expect(count).toBeLessThanOrEqual(2);
    expect(claimSpy).toHaveBeenCalledTimes(2);
  });
});
