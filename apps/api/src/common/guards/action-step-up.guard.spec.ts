import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../../auth/__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from '../../auth/__fixtures__/test-keys-2';
import { deriveKeyId } from '../../auth/jwt-key-id';
import { ActionStepUpGuard } from './action-step-up.guard';

function guard(env: Record<string, string | undefined> = {}): ActionStepUpGuard {
  return new ActionStepUpGuard({
    get: (key: string, fallback?: unknown) => {
      if (key === 'JWT_ISSUER') return 'waitlayer';
      if (key === 'JWT_AUDIENCE') return 'waitlayer-client';
      if (key === 'JWT_PUBLIC_KEY') return env.JWT_PUBLIC_KEY ?? TEST_JWT_PUBLIC_KEY;
      if (key === 'JWT_PUBLIC_KEYS') return env.JWT_PUBLIC_KEYS;
      return fallback;
    },
  } as never);
}

async function makeToken(
  action: string,
  sub = 'u-1',
  expiresIn = '5m',
  signingKey: { privateKey: string; publicKey: string } = {
    privateKey: TEST_JWT_PRIVATE_KEY,
    publicKey: TEST_JWT_PUBLIC_KEY,
  },
): Promise<string> {
  // Production step-up tokens are stamped with a `kid` (the JwtModule signOptions
  // sets keyid), so the test token mirrors that to exercise kid-aware verification.
  const jwt = new JwtService({
    privateKey: signingKey.privateKey,
    publicKey: signingKey.publicKey,
    signOptions: { algorithm: 'RS256', expiresIn, keyid: deriveKeyId(signingKey.publicKey) },
  });
  return jwt.signAsync(
    { sub, action, aud: ['waitlayer-client', 'step-up'], iss: 'waitlayer' },
    { expiresIn },
  );
}

describe('ActionStepUpGuard', () => {
  it('allows a valid action-scoped step-up token', async () => {
    const token = await makeToken('payout:request');
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    expect(guard().canActivate(ctx)).toBe(true);
  });

  it('rejects when the step-up token is missing', () => {
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', user: { id: 'u-1' }, headers: {} }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    expect(() => guard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the action does not match', async () => {
    const token = await makeToken('payout:method');
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    expect(() => guard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the user does not match', async () => {
    const token = await makeToken('payout:request', 'u-2');
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    expect(() => guard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an expired step-up token', async () => {
    const token = await makeToken('payout:request', 'u-1', '-1s');
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    expect(() => guard().canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('accepts a step-up token signed by the PREVIOUS key during rotation grace', async () => {
    // Operator rotated to key #2 but still trusts key #1 in JWT_PUBLIC_KEYS.
    // A step-up token issued just before the rotation (signed with the old key)
    // must still verify within its 5m TTL — zero-downtime rotation.
    const token = await makeToken('payout:request', 'u-1', '5m', {
      privateKey: TEST_JWT_PRIVATE_KEY,
      publicKey: TEST_JWT_PUBLIC_KEY,
    });
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    const rotatingGuard = guard({
      JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY_2,
      JWT_PUBLIC_KEYS: TEST_JWT_PUBLIC_KEY,
    });
    expect(rotatingGuard.canActivate(ctx)).toBe(true);
  });

  it('rejects a step-up token whose kid is not in the accepted set', async () => {
    const token = await makeToken('payout:request', 'u-1', '5m', {
      privateKey: TEST_JWT_PRIVATE_KEY_2,
      publicKey: TEST_JWT_PUBLIC_KEY_2,
    });
    const handler = () => undefined;
    Reflect.defineMetadata('stepUpAction', 'payout:request', handler);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'u-1' },
          headers: { 'x-step-up-token': token },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    // Only the #1 key is trusted; a token signed by #2 must be rejected.
    expect(() => guard({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY }).canActivate(ctx)).toThrow(
      ForbiddenException,
    );
  });
});
