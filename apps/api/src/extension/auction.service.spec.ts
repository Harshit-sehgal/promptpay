import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { BidType } from '@waitlayer/db';

import { AuctionCampaign, AuctionService } from './auction.service';

// Isolate the selection engine from the balance lookup and URL-policy helpers.
vi.mock('../common/utils/advertiser-balance', () => ({
  getAdvertiserBalancesByCurrency: vi.fn(),
}));
vi.mock('../common/utils/external-url-policy', () => ({
  normalizeCreativeDestination: (c: unknown) => c,
}));

import { getAdvertiserBalancesByCurrency } from '../common/utils/advertiser-balance';

const oneHourAgo = new Date(Date.now() - 3600_000);
const oneDayAgo = new Date(Date.now() - 86400_000);

interface MockPrisma {
  adImpression: { findMany: Mock };
  campaign: { findMany: Mock };
}

const makeCampaign = (over: Partial<AuctionCampaign> & { id: string }): AuctionCampaign => ({
  id: over.id,
  advertiserId: 'a1',
  name: 'c',
  status: 'active',
  category: 'dev',
  bidType: BidType.cpm,
  bidAmountMinor: 100n,
  budgetTotalMinor: 1000n,
  budgetSpentMinor: 0n,
  budgetReservedMinor: 0n,
  currency: 'USD',
  frequencyCapPerHour: 0,
  frequencyCapPerDay: 0,
  creatives: [
    {
      id: `cr-${over.id}`,
      title: 'T',
      sponsoredMessage: 'M',
      displayDomain: 'x.com',
      destinationUrl: 'https://x.com',
      ctaText: null,
    },
  ],
  countryTargeting: [],
  ...over,
});

describe('AuctionService', () => {
  let prisma: MockPrisma;
  let svc: AuctionService;

  beforeEach(() => {
    prisma = {
      adImpression: { findMany: vi.fn().mockResolvedValue([]) },
      campaign: { findMany: vi.fn() },
    };
    svc = new AuctionService(prisma as never, { log: vi.fn() } as never);
  });

  it('selectEligibleCampaign returns a campaign that passes budget/category/balance filters', async () => {
    const camp = makeCampaign({ id: 'c1' });
    prisma.campaign.findMany.mockResolvedValue([camp]);
    (getAdvertiserBalancesByCurrency as unknown as Mock).mockResolvedValue(
      new Map([['a1:USD', 1_000_000n]]),
    );
    const eligible = await svc.selectEligibleCampaign({
      userId: 'u',
      effectiveBlocked: [],
      userCountry: null,
      oneHourAgo,
      oneDayAgo,
    });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('c1');
  });

  it('selectEligibleCampaign excludes a campaign that cannot cover its next charge', async () => {
    // spent 100 + charge 1000 > 1000 total → excluded before the auction even runs.
    const camp = makeCampaign({
      id: 'low',
      bidAmountMinor: 1000n,
      budgetTotalMinor: 1000n,
      budgetSpentMinor: 100n,
    });
    prisma.campaign.findMany.mockResolvedValue([camp]);
    (getAdvertiserBalancesByCurrency as unknown as Mock).mockResolvedValue(
      new Map([['a1:USD', 1_000_000n]]),
    );
    const eligible = await svc.selectEligibleCampaign({
      userId: 'u',
      effectiveBlocked: [],
      userCountry: null,
      oneHourAgo,
      oneDayAgo,
    });
    expect(eligible).toHaveLength(0);
  });

  it('selectEligibleCampaign excludes a campaign whose advertiser lacks balance in the campaign currency', async () => {
    const camp = makeCampaign({ id: 'c1', currency: 'USD' });
    prisma.campaign.findMany.mockResolvedValue([camp]);
    // Advertiser only holds EUR — must NOT serve the USD campaign.
    (getAdvertiserBalancesByCurrency as unknown as Mock).mockResolvedValue(
      new Map([['a1:EUR', 1_000_000n]]),
    );
    const eligible = await svc.selectEligibleCampaign({
      userId: 'u',
      effectiveBlocked: [],
      userCountry: null,
      oneHourAgo,
      oneDayAgo,
    });
    expect(eligible).toHaveLength(0);
  });

  it('runAuction retries the next candidate when the winner loses the reservation race', async () => {
    const a = makeCampaign({ id: 'a', bidAmountMinor: 100n });
    const b = makeCampaign({ id: 'b', bidAmountMinor: 90n });
    const adCache = { set: vi.fn() } as never;
    let firstWon = false;
    const res = await svc.runAuction({
      eligible: [a, b],
      userId: 'u',
      deviceId: 'd',
      sessionId: 's',
      waitStateId: 'w',
      idempotencyKey: 'i',
      maxPerHour: 6,
      oneHourAgo,
      adCache,
      claimImpression: async (args) => {
        if (!firstWon && args.campaignId === 'a') {
          firstWon = true;
          return { status: 'budget_unavailable' };
        }
        return { status: 'claimed', impressionId: 'imp1' };
      },
    });
    expect(res.ad).not.toBeNull();
  });

  it('runAuction returns no_eligible_campaign only after every candidate loses the reservation', async () => {
    const a = makeCampaign({ id: 'a' });
    const b = makeCampaign({ id: 'b' });
    const adCache = { set: vi.fn() } as never;
    const res = await svc.runAuction({
      eligible: [a, b],
      userId: 'u',
      deviceId: 'd',
      sessionId: 's',
      waitStateId: 'w',
      idempotencyKey: 'i',
      maxPerHour: 6,
      oneHourAgo,
      adCache,
      claimImpression: async () => ({ status: 'budget_unavailable' }),
    });
    expect(res.ad).toBeNull();
    expect(res.reason).toBe('no_eligible_campaign');
  });
});
