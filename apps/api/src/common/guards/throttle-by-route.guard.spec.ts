import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';

import { RequestLike,ThrottleByRouteGuard } from './throttle-by-route.guard';

interface StorageLike {
  increment: ReturnType<typeof vi.fn>;
}

class ProbeGuard extends ThrottleByRouteGuard {
  storage: StorageLike;

  constructor(storage: StorageLike) {
    super({} as never, storage, { get: () => undefined } as never);
    this.storage = storage;
    (this as unknown as { commonOptions: Record<string, unknown> }).commonOptions = {};
  }

  async probe(path: string, throttlerName: string, ip = '203.0.113.10'): Promise<boolean> {
    const res = { header: vi.fn() };
    const req = {
      ip,
      route: { path },
      url: path,
      connection: { remoteAddress: ip },
      headers: {},
    } as RequestLike;
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getClass: () => class {},
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
    return this.handleRequest({
      context,
      limit: 5,
      ttl: 60,
      blockDuration: 120,
      throttler: { name: throttlerName, setHeaders: true },
      getTracker: async () => `ip:${ip}`,
      generateKey: () => 'probe-key',
    } as never);
  }
}

function makeProbe(): ProbeGuard {
  const storage: StorageLike = {
    increment: vi.fn().mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  };
  return new ProbeGuard(storage);
}

describe('ThrottleByRouteGuard', () => {
  it('enforces the auth-short bucket for credential-bearing auth routes', async () => {
    for (const path of [
      '/auth/login',
      '/auth/signup',
      '/auth/google',
      '/auth/verify-email/abc',
      '/auth/2fa/setup',
      '/auth/password/reset',
    ]) {
      const matching = makeProbe();
      await expect(matching.probe(path, 'auth-short')).resolves.toBe(true);
      expect(matching.storage.increment).toHaveBeenCalledOnce();

      const wrong = makeProbe();
      await expect(wrong.probe(path, 'default')).resolves.toBe(true);
      expect(wrong.storage.increment).not.toHaveBeenCalled();
    }
  });

  it('enforces the auth-long bucket for refresh', async () => {
    const matching = makeProbe();
    await expect(matching.probe('/auth/refresh', 'auth-long')).resolves.toBe(true);
    expect(matching.storage.increment).toHaveBeenCalledOnce();

    const wrong = makeProbe();
    await expect(wrong.probe('/auth/refresh', 'auth-short')).resolves.toBe(true);
    expect(wrong.storage.increment).not.toHaveBeenCalled();
  });

  it('enforces the extension bucket for extension routes', async () => {
    const matching = makeProbe();
    await expect(matching.probe('/extension/request-ad', 'extension')).resolves.toBe(true);
    expect(matching.storage.increment).toHaveBeenCalledOnce();

    const wrong = makeProbe();
    await expect(wrong.probe('/extension/request-ad', 'default')).resolves.toBe(true);
    expect(wrong.storage.increment).not.toHaveBeenCalled();
  });

  it('lets only the default bucket handle non-matching routes', async () => {
    const matching = makeProbe();
    await expect(matching.probe('/developer/dashboard', 'default')).resolves.toBe(true);
    expect(matching.storage.increment).toHaveBeenCalledOnce();

    const wrong = makeProbe();
    await expect(wrong.probe('/developer/dashboard', 'auth-short')).resolves.toBe(true);
    expect(wrong.storage.increment).not.toHaveBeenCalled();
  });
});
