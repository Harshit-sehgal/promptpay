import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionService } from './extension.service';

// A-039/A-055 balance helper is mocked so the post-filter advertiser-balance
// gate does not require a real database.

vi.mock('../common/utils/advertiser-balance', () => ({
  getAdvertiserBalance: vi.fn(),
  getAdvertiserBalancesByCurrency: vi.fn(async () => new Map([['adv-1:USD', 1_000_000]])),
}));

// isCountryEligible was extracted from ExtensionService into country-targeting.ts
// (pure function). The blocked-category tests don't exercise country targeting,
// so mock it to always return true to keep the existing assertion scope.
// NOTE: vi.mock is HOISTED to the top of the file, so the factory cannot
// reference any outer variable (temporal dead zone). Define the mock inline.
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

const financeCampaign = {
  id: 'camp-finance',
  advertiserId: 'adv-1',
  currency: 'USD',
  bidAmountMinor: 100,
  budgetSpentMinor: 0,
  budgetTotalMinor: 1000,
  frequencyCapPerHour: 0,
  frequencyCapPerDay: 0,
  category: 'finance',
  creatives: [makeCreative('cr-finance')],
  countryTargeting: [],
};

const gamingCampaign = {
  id: 'camp-gaming',
  advertiserId: 'adv-1',
  currency: 'USD',
  bidAmountMinor: 100,
  budgetSpentMinor: 0,
  budgetTotalMinor: 1000,
  frequencyCapPerHour: 0,
  frequencyCapPerDay: 0,
  category: 'gaming',
  creatives: [makeCreative('cr-gaming')],
  countryTargeting: [],
};

function buildService(prismaMock: any) {
  const audit = { log: vi.fn() } as any;
  const ledger = {} as any;
  const fraud = {} as any;
  const compliance = { isConsented: vi.fn(async () => false) } as any;
  const googleVerifier = {} as any;
  const service = new ExtensionService(
    prismaMock,
    audit,
    ledger,
    fraud,
    compliance,
    googleVerifier,
  );

  // Collapse the heavy post-filter machinery so we only assert selection.
  // isCountryEligible is mocked at the module level (vi.mock('./country-targeting'))
  // because it was extracted from ExtensionService as a pure function.
  vi.spyOn(service as any, 'verifyDeviceSignature').mockResolvedValue(true);
  vi.spyOn(service as any, 'recentBillableCampaignIds').mockResolvedValue([]);
  const claimSpy = vi
    .spyOn(service as any, 'claimImpression')
    .mockResolvedValue({ status: 'claimed', impressionId: 'imp-1' });
  return { service, claimSpy };
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

describe('requestAd persisted blocked-category enforcement (A-057)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suppresses a campaign whose category is in the developer PERSISTED blocked list, even when the client omits blockedCategories', async () => {
    const prisma = {
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
            ? { id: 'ws-evt', createdAt: new Date() }
            : null,
        ),
      },
      userSettings: {
        findUnique: vi.fn(async () => ({
          blockedCategories: ['finance'],
          adsEnabled: true,
          quietMode: false,
          timezone: 'UTC',
        })),
      },
      user: { findUnique: vi.fn(async () => ({ country: null })) },
      adImpression: { findMany: vi.fn(async () => []) },
      campaign: {
        findMany: vi.fn(async () => [financeCampaign, gamingCampaign]),
      },
    } as any;

    const { service, claimSpy } = buildService(prisma);

    await service.requestAd('user-1', baseDto);

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy.mock.calls[0][0].campaignId).toBe('camp-gaming');
    expect(claimSpy.mock.calls[0][0].campaignId).not.toBe('camp-finance');
  });

  it('does NOT suppress an unrelated category when only finance is blocked', async () => {
    const prisma = {
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
            ? { id: 'ws-evt', createdAt: new Date() }
            : null,
        ),
      },
      userSettings: {
        findUnique: vi.fn(async () => ({
          blockedCategories: ['finance'],
          adsEnabled: true,
          quietMode: false,
          timezone: 'UTC',
        })),
      },
      user: { findUnique: vi.fn(async () => ({ country: null })) },
      adImpression: { findMany: vi.fn(async () => []) },
      campaign: { findMany: vi.fn(async () => [gamingCampaign]) },
    } as any;

    const { service, claimSpy } = buildService(prisma);

    await service.requestAd('user-1', baseDto);

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy.mock.calls[0][0].campaignId).toBe('camp-gaming');
  });

  it('serves nothing when the only eligible campaign is blocked by the persisted preference', async () => {
    const prisma = {
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
            ? { id: 'ws-evt', createdAt: new Date() }
            : null,
        ),
      },
      userSettings: {
        findUnique: vi.fn(async () => ({
          blockedCategories: ['finance'],
          adsEnabled: true,
          quietMode: false,
          timezone: 'UTC',
        })),
      },
      user: { findUnique: vi.fn(async () => ({ country: null })) },
      adImpression: { findMany: vi.fn(async () => []) },
      campaign: { findMany: vi.fn(async () => [financeCampaign]) },
    } as any;

    const { service, claimSpy } = buildService(prisma);

    const res = await service.requestAd('user-1', baseDto);

    expect(claimSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ ad: null, reason: 'no_eligible_campaign' });
  });
});
