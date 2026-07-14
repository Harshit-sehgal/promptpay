import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from '../../auth/__fixtures__/test-keys';
import { ActionStepUpGuard } from './action-step-up.guard';

function guard(): ActionStepUpGuard {
  return new ActionStepUpGuard({
    get: (key: string, fallback?: unknown) => {
      if (key === 'JWT_ISSUER') return 'waitlayer';
      if (key === 'JWT_AUDIENCE') return 'waitlayer-client';
      if (key === 'JWT_PUBLIC_KEY') return TEST_JWT_PUBLIC_KEY;
      return fallback;
    },
  } as never);
}

async function makeToken(action: string, sub = 'u-1', expiresIn = '5m'): Promise<string> {
  const jwt = new JwtService({
    privateKey: TEST_JWT_PRIVATE_KEY,
    publicKey: TEST_JWT_PUBLIC_KEY,
    signOptions: { algorithm: 'RS256', expiresIn },
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
});
