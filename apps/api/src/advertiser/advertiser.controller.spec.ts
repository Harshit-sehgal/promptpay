import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StripeProvider } from '../payout/providers';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';

function makeController() {
  const service = {
    createProfile: vi.fn(),
    getOrCreateProfile: vi.fn(),
  };

  return {
    service,
    controller: new AdvertiserController(
      service as unknown as AdvertiserService,
      {} as StripeProvider,
      {} as ConfigService,
    ),
  };
}

describe('AdvertiserController profile creation', () => {
  it('creates a profile directly for JWT users without pre-creating one', async () => {
    const { controller, service } = makeController();
    const dto = {
      companyName: 'Acme',
      billingEmail: 'billing@example.com',
      websiteUrl: 'https://example.com',
    };
    service.createProfile.mockResolvedValue({ id: 'adv-1', ...dto });

    const result = await controller.createProfile(
      { user: { sub: 'user-1' } } as unknown as Request,
      dto,
    );

    expect(result).toEqual({ id: 'adv-1', ...dto });
    expect(service.getOrCreateProfile).not.toHaveBeenCalled();
    expect(service.createProfile).toHaveBeenCalledWith('user-1', dto);
  });

  it('rejects API-key profile creation because keys are scoped to existing advertisers', async () => {
    const { controller, service } = makeController();

    await expect(
      controller.createProfile(
        {
          apiKey: {
            scopes: ['advertiser:write'],
            advertiserId: 'adv-1',
            ownerId: 'owner-1',
          },
        } as unknown as Request,
        {
          companyName: 'Acme',
          billingEmail: 'billing@example.com',
        },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(service.createProfile).not.toHaveBeenCalled();
    expect(service.getOrCreateProfile).not.toHaveBeenCalled();
  });

  it('rejects profile creation without an authenticated principal', async () => {
    const { controller, service } = makeController();

    await expect(
      controller.createProfile(
        {} as unknown as Request,
        {
          companyName: 'Acme',
          billingEmail: 'billing@example.com',
        },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(service.createProfile).not.toHaveBeenCalled();
  });
});
