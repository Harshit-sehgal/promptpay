import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

function makeController() {
  const service = {
    createCreative: vi.fn(),
  };
  const prisma = {
    advertiser: { findUnique: vi.fn() },
    adCreative: { findUnique: vi.fn() },
  };

  return {
    service,
    prisma,
    controller: new CampaignController(
      service as unknown as CampaignService,
      prisma as unknown as PrismaService,
    ),
  };
}

describe('CampaignController API-key actor resolution', () => {
  it('passes advertiser-scoped API-key actor to creative creation', async () => {
    const { controller, service, prisma } = makeController();
    const dto = {
      title: 'Sponsor',
      sponsoredMessage: 'Try this tool',
      destinationUrl: 'https://example.com',
      displayDomain: 'example.com',
    };
    service.createCreative.mockResolvedValue({ id: 'creative-1', ...dto });

    const result = await controller.createCreative(
      'campaign-1',
      'owner-1',
      'advertiser',
      dto,
      {
        apiKey: {
          ownerId: 'owner-1',
          advertiserId: 'advertiser-1',
          scopes: ['campaigns:write'],
        },
      } as any,
    );

    expect(result).toEqual({ id: 'creative-1', ...dto });
    expect(prisma.advertiser.findUnique).not.toHaveBeenCalled();
    expect(service.createCreative).toHaveBeenCalledWith(
      'campaign-1',
      dto,
      { userId: 'owner-1', role: 'advertiser', advertiserId: 'advertiser-1' },
    );
  });

  it('rejects generic API keys that are not scoped to an advertiser', async () => {
    const { controller, service } = makeController();

    await expect(
      controller.createCreative(
        'campaign-1',
        'owner-1',
        'developer',
        {
          title: 'Sponsor',
          sponsoredMessage: 'Try this tool',
          destinationUrl: 'https://example.com',
          displayDomain: 'example.com',
        },
        {
          apiKey: {
            ownerId: 'owner-1',
            advertiserId: null,
            scopes: ['campaigns:write'],
          },
        } as any,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(service.createCreative).not.toHaveBeenCalled();
  });
});
