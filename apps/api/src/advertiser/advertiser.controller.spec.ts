import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';

import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { StripeProvider } from '../payout/providers';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserService } from './advertiser.service';

function makeController() {
  const service = {
    createProfile: vi.fn(),
    getOrCreateProfile: vi.fn(),
    exportData: vi.fn(),
    deleteAccount: vi.fn(),
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
      controller.createProfile({} as unknown as Request, {
        companyName: 'Acme',
        billingEmail: 'billing@example.com',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(service.createProfile).not.toHaveBeenCalled();
  });
});

/**
 * A-044: advertiser self-service export & erasure are JWT-only by design even
 * though the controller is class-decorated `@AllowApiKey()`. A long-lived
 * `advertiser:write` API key must never be able to export personal data or
 * erase the account. The route-level `RejectApiKeyGuard` enforces this; these
 * tests prove the guard is wired onto both routes, that it rejects an API-key
 * request, and that a normal JWT request still reaches the handler.
 */
describe('AdvertiserController export/delete API-key boundary (A-044)', () => {
  function guardsFor(method: (...args: never[]) => unknown): unknown[] {
    return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
  }

  function buildContext(req: Partial<Request>) {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as Parameters<RejectApiKeyGuard['canActivate']>[0];
  }

  it('guards export-data and delete-account with RejectApiKeyGuard', () => {
    expect(guardsFor(AdvertiserController.prototype.exportData)).toContain(RejectApiKeyGuard);
    expect(guardsFor(AdvertiserController.prototype.deleteAccount)).toContain(RejectApiKeyGuard);
  });

  it('rejects an API-key request to the export/delete routes', () => {
    const guard = new RejectApiKeyGuard();
    const req = {
      apiKey: { scopes: ['advertiser:write'], advertiserId: 'adv-1', ownerId: 'owner-1' },
    };
    expect(() => guard.canActivate(buildContext(req))).toThrow(ForbiddenException);
  });

  it('allows a JWT export-data request to reach the handler', async () => {
    const guard = new RejectApiKeyGuard();
    // A JWT-only request has no `apiKey` principal, so the guard passes.
    expect(guard.canActivate(buildContext({ user: { sub: 'user-1' } }))).toBe(true);

    const { controller, service } = makeController();
    service.exportData.mockResolvedValue({ ok: true });

    await expect(controller.exportData('user-1')).resolves.toEqual({ ok: true });
    expect(service.exportData).toHaveBeenCalledWith('user-1');
  });

  it('allows a JWT delete-account request to reach the handler', async () => {
    const guard = new RejectApiKeyGuard();
    expect(guard.canActivate(buildContext({ user: { sub: 'user-1' } }))).toBe(true);

    const { controller, service } = makeController();
    service.deleteAccount.mockResolvedValue({ ok: true });

    await expect(
      controller.deleteAccount('user-1', { confirmation: 'DELETE_MY_ACCOUNT' }),
    ).resolves.toEqual({ ok: true });
    expect(service.deleteAccount).toHaveBeenCalledWith('user-1', {
      currentPassword: undefined,
      googleIdToken: undefined,
    });
  });
});
