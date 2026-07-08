import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../config/prisma.service';
import { JwtStrategy } from './jwt.strategy';

function makeStrategy() {
  const prisma = {
    session: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-at-least-32-characters-long';
      return undefined;
    }),
  } as unknown as ConfigService;

  return {
    strategy: new JwtStrategy(config, prisma as unknown as PrismaService),
    prisma,
  };
}

describe('JwtStrategy', () => {
  it('returns active users for valid unrevoked access-token sessions', async () => {
    const { strategy, prisma } = makeStrategy();
    const user = {
      id: 'u-active',
      email: 'active@test.com',
      role: 'developer',
      status: 'active',
      trustLevel: 'new',
    };
    prisma.session.findUnique.mockResolvedValue({ id: 'sess-active', revoked: false });
    prisma.user.findUnique.mockResolvedValue(user);

    await expect(
      strategy.validate({ sub: 'u-active', role: 'developer', jti: 'sess-active', aud: 'access' }),
    ).resolves.toEqual({ ...user, jti: 'sess-active' });
  });

  it('rejects restricted users even when the session is unrevoked', async () => {
    const { strategy, prisma } = makeStrategy();
    prisma.session.findUnique.mockResolvedValue({ id: 'sess-restricted', revoked: false });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-restricted',
      email: 'restricted@test.com',
      role: 'developer',
      status: 'restricted',
      trustLevel: 'new',
    });

    await expect(
      strategy.validate({ sub: 'u-restricted', role: 'developer', jti: 'sess-restricted', aud: 'access' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects revoked sessions before loading the user', async () => {
    const { strategy, prisma } = makeStrategy();
    prisma.session.findUnique.mockResolvedValue({ id: 'sess-revoked', revoked: true });

    await expect(
      strategy.validate({ sub: 'u-active', role: 'developer', jti: 'sess-revoked', aud: 'access' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
