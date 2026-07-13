import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { CreativeResponse } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { CampaignService } from './campaign.service';

function makeService() {
  const prisma: any = {
    advertiser: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    adCreative: {
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((callback: (tx: any) => unknown) => callback(prisma)),
  };
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
    logStrict: vi.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    audit,
    service: new CampaignService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
  };
}

describe('CampaignService creative URL policy', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('normalizes safe creative URLs and display domains before storage', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });
    ctx.prisma.adCreative.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'creative-1',
        ...args.data,
      }),
    );

    await ctx.service.createCreative(
      'camp-1',
      {
        title: 'Safe ad',
        sponsoredMessage: 'Try this developer tool',
        destinationUrl: ' https://www.example.com/offer ',
        displayDomain: 'Example.COM',
      },
      { role: 'admin' },
    );

    expect(ctx.prisma.adCreative.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        destinationUrl: 'https://www.example.com/offer',
        displayDomain: 'example.com',
      }),
    });
    expect(ctx.audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create_creative', targetId: 'creative-1' }),
      ctx.prisma,
    );
  });

  it('does not acknowledge creative creation when durable audit persistence fails', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });
    ctx.prisma.adCreative.create.mockResolvedValue({ id: 'creative-1' });
    ctx.audit.logStrict.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      ctx.service.createCreative(
        'camp-1',
        {
          title: 'Safe ad',
          sponsoredMessage: 'Try this developer tool',
          destinationUrl: 'https://example.com/offer',
          displayDomain: 'example.com',
        },
        { role: 'admin', userId: 'admin-1' },
      ),
    ).rejects.toThrow('audit unavailable');
  });

  it('rejects deceptive display domains on create', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });

    await expect(
      ctx.service.createCreative(
        'camp-1',
        {
          title: 'Bad ad',
          sponsoredMessage: 'Mismatched destination',
          destinationUrl: 'https://evil.example.net/offer',
          displayDomain: 'trusted.example.com',
        },
        { role: 'admin' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.adCreative.create).not.toHaveBeenCalled();
  });

  it('rejects creation beyond the bounded per-campaign creative quota', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });
    ctx.prisma.adCreative.count.mockResolvedValue(100);

    await expect(
      ctx.service.createCreative(
        'camp-1',
        {
          title: 'One too many',
          sponsoredMessage: 'Bound storage growth',
          destinationUrl: 'https://example.com/offer',
          displayDomain: 'example.com',
        },
        { role: 'admin' },
      ),
    ).rejects.toThrow(/at most 100 creatives/);
    expect(ctx.prisma.adCreative.create).not.toHaveBeenCalled();
  });

  it('derives displayDomain when destinationUrl changes without a displayDomain patch', async () => {
    ctx.prisma.adCreative.findUnique.mockResolvedValue({
      id: 'creative-1',
      campaignId: 'camp-1',
      destinationUrl: 'https://old.example.com/offer',
    });
    ctx.prisma.adCreative.update.mockResolvedValue({ id: 'creative-1' });

    await ctx.service.updateCreative(
      'creative-1',
      {
        destinationUrl: 'https://new.example.com/offer',
      },
      { role: 'admin' },
    );

    expect(ctx.prisma.adCreative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: expect.objectContaining({
        destinationUrl: 'https://new.example.com/offer',
        displayDomain: 'new.example.com',
        status: 'draft',
        rejectionReason: null,
      }),
    });
  });

  it('stores ctaText on create when provided (A-022)', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });
    ctx.prisma.adCreative.create.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'creative-2',
        ...args.data,
      }),
    );

    await ctx.service.createCreative(
      'camp-1',
      {
        title: 'Safe ad',
        sponsoredMessage: 'Try this developer tool',
        destinationUrl: 'https://www.example.com/offer',
        displayDomain: 'example.com',
        ctaText: 'Learn more',
      },
      { role: 'admin' },
    );

    expect(ctx.prisma.adCreative.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ctaText: 'Learn more' }) }),
    );
  });

  it('persists the exact reviewer rejection reason on the creative (A-045)', async () => {
    ctx.prisma.adCreative.findUnique.mockResolvedValue({ id: 'creative-1', campaignId: 'camp-1' });
    ctx.prisma.adCreative.update.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'creative-1',
        ...args.data,
      }),
    );

    const reason = 'Headline overstates performance claims with unverified stats';
    const updated = await ctx.service.rejectCreative('creative-1', reason);

    expect(ctx.prisma.adCreative.update).toHaveBeenCalledWith({
      where: { id: 'creative-1' },
      data: { status: 'rejected', rejectionReason: reason },
    });
    expect(updated.rejectionReason).toBe(reason);
    expect(ctx.audit.log).not.toHaveBeenCalled();
    expect(ctx.audit.logStrict).not.toHaveBeenCalled();
  });

  it('rejects a creative rejection with an empty reason (A-045)', async () => {
    ctx.prisma.adCreative.findUnique.mockResolvedValue({ id: 'creative-1', campaignId: 'camp-1' });

    await expect(ctx.service.rejectCreative('creative-1', '')).rejects.toThrow(BadRequestException);
    await expect(ctx.service.rejectCreative('creative-1', '   ')).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.prisma.adCreative.update).not.toHaveBeenCalled();
  });

  it('CreativeResponse contract accepts ctaText (A-022)', () => {
    const parsed = CreativeResponse.parse({
      id: 'creative-1',
      campaignId: 'camp-1',
      title: 't',
      sponsoredMessage: 'm',
      destinationUrl: 'https://e.com',
      displayDomain: 'e.com',
      ctaText: 'Learn more',
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.ctaText).toBe('Learn more');

    // ctaText is optional/nullable.
    const without = CreativeResponse.parse({
      id: 'creative-2',
      campaignId: 'camp-1',
      title: 't',
      sponsoredMessage: 'm',
      destinationUrl: 'https://e.com',
      displayDomain: 'e.com',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(without.ctaText).toBeUndefined();
  });
});
