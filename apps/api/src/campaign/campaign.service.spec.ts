import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { CampaignService } from './campaign.service';

function makeService() {
  const prisma = {
    advertiser: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    adCreative: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };

  return {
    prisma,
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
    ctx.prisma.adCreative.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'creative-1',
      ...args.data,
    }));

    await ctx.service.createCreative('camp-1', {
      title: 'Safe ad',
      sponsoredMessage: 'Try this developer tool',
      destinationUrl: ' https://www.example.com/offer ',
      displayDomain: 'Example.COM',
    }, { role: 'admin' });

    expect(ctx.prisma.adCreative.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        destinationUrl: 'https://www.example.com/offer',
        displayDomain: 'example.com',
      }),
    });
  });

  it('rejects deceptive display domains on create', async () => {
    ctx.prisma.campaign.findUnique.mockResolvedValue({ id: 'camp-1', status: 'draft' });

    await expect(
      ctx.service.createCreative('camp-1', {
        title: 'Bad ad',
        sponsoredMessage: 'Mismatched destination',
        destinationUrl: 'https://evil.example.net/offer',
        displayDomain: 'trusted.example.com',
      }, { role: 'admin' }),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.adCreative.create).not.toHaveBeenCalled();
  });

  it('derives displayDomain when destinationUrl changes without a displayDomain patch', async () => {
    ctx.prisma.adCreative.findUnique.mockResolvedValue({
      id: 'creative-1',
      campaignId: 'camp-1',
      destinationUrl: 'https://old.example.com/offer',
    });
    ctx.prisma.adCreative.update.mockResolvedValue({ id: 'creative-1' });

    await ctx.service.updateCreative('creative-1', {
      destinationUrl: 'https://new.example.com/offer',
    }, { role: 'admin' });

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
});
