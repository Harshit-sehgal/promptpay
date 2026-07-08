import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { ApiKeyService } from './api-key.service';

function makeService() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
    },
    advertiser: {
      findUnique: vi.fn(),
    },
    apiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const audit = {
    log: vi.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    service: new ApiKeyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
  };
}

describe('ApiKeyService account-status policy', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('mints API keys for active users', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ status: 'active' });
    ctx.prisma.apiKey.create.mockResolvedValue({
      id: 'key-1',
      keyPrefix: 'wl_abcdef0',
      scopes: ['reports:read'],
      expiresAt: null,
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    });

    const result = await ctx.service.generateApiKey('user-1', ['reports:read']);

    expect(result.plainKey).toMatch(/^wl_[a-f0-9]{64}$/);
    expect(ctx.prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'user-1',
        scopes: ['reports:read'],
        isActive: true,
      }),
    });
  });

  it('rejects API-key minting for restricted users', async () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ status: 'restricted' });

    await expect(
      ctx.service.generateApiKey('user-1', ['reports:read']),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('rejects existing API keys when the owner is restricted', async () => {
    ctx.prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      owner: { id: 'user-1', status: 'restricted', trustLevel: 'restricted', role: 'developer' },
    });

    await expect(ctx.service.validateApiKey('wl_test')).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('updates lastUsedAt for active-owner keys', async () => {
    ctx.prisma.apiKey.findUnique.mockResolvedValue({
      id: 'key-1',
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      owner: { id: 'user-1', status: 'active', trustLevel: 'normal', role: 'developer' },
    });
    ctx.prisma.apiKey.update.mockResolvedValue({});

    await expect(ctx.service.validateApiKey('wl_test')).resolves.toMatchObject({ id: 'key-1' });
    expect(ctx.prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
