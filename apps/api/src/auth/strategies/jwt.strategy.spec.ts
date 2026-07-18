import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../config/prisma.service';
import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from '../__fixtures__/test-keys-2';
import { deriveKeyId } from '../jwt-key-id';
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
      if (key === 'JWT_PUBLIC_KEY') return TEST_JWT_PUBLIC_KEY;
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
    ).resolves.toMatchObject({ ...user, jti: 'sess-active', authMethod: 'jwt' });
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
      strategy.validate({
        sub: 'u-restricted',
        role: 'developer',
        jti: 'sess-restricted',
        aud: 'access',
      }),
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

describe('JwtStrategy key rotation (kid-aware verification)', () => {
  function makeStrategy(env: Record<string, string | undefined>) {
    const prisma = {
      session: { findUnique: vi.fn().mockResolvedValue({ id: 'sess', revoked: false }) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'u@test.com',
          role: 'developer',
          status: 'active',
          trustLevel: 'new',
          twoFactorEnabled: false,
        }),
      },
    };
    const config = {
      get: vi.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return { strategy: new JwtStrategy(config, prisma as unknown as PrismaService), prisma };
  }

  function sign(privateKey: string, publicKey: string, payload: Record<string, unknown>) {
    return new JwtService({
      privateKey,
      signOptions: { algorithm: 'RS256', keyid: deriveKeyId(publicKey) },
    }).sign(payload);
  }

  it('verifies a token signed by the PREVIOUS key during a rotation grace window', async () => {
    // Operator rotated to key #2 but still trusts key #1 in JWT_PUBLIC_KEYS.
    const { strategy } = makeStrategy({
      JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY_2,
      JWT_PUBLIC_KEYS: TEST_JWT_PUBLIC_KEY,
      JWT_ISSUER: 'waitlayer',
      JWT_AUDIENCE: 'waitlayer-client',
    });
    const oldToken = sign(TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY, {
      sub: 'u1',
      role: 'developer',
      jti: 'sess',
      aud: 'access',
      iss: 'waitlayer',
    });
    // The strategy's key resolver (used by secretOrKeyProvider) selects the
    // previous public key for the old kid — proving pre-rotation tokens still
    // verify during the grace window.
    expect(strategy.keySet.keys.size).toBe(2);
    expect(strategy.resolveVerificationKey(oldToken)).toBe(TEST_JWT_PUBLIC_KEY);
  });

  it('rejects a token whose kid is not in the accepted set', async () => {
    const { strategy } = makeStrategy({
      JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
      JWT_ISSUER: 'waitlayer',
      JWT_AUDIENCE: 'waitlayer-client',
    });
    const foreignToken = sign(TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2, {
      sub: 'u1',
      role: 'developer',
      jti: 'sess',
      aud: 'access',
      iss: 'waitlayer',
    });
    expect(() => strategy.resolveVerificationKey(foreignToken)).toThrow(UnauthorizedException);
  });

  it('throws at construction when no verification key is configured', () => {
    expect(() => makeStrategy({})).toThrow(/must be defined/);
  });
});
