import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { RejectApiKeyGuard } from './reject-api-key.guard';

/**
 * A-037: advertiser export-data / delete-account are JWT-only by design. Their
 * controller is class-decorated `@AllowApiKey()` so a long-lived
 * `advertiser:write` key must NOT be able to silently export or erase an
 * account. The RejectApiKeyGuard enforces that at the Nest layer; these tests
 * prove the guard fires for API-key requests and passes for JWT requests.
 */
function buildContext(req: Partial<Request>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as Parameters<RejectApiKeyGuard['canActivate']>[0];
}

describe('RejectApiKeyGuard (A-037)', () => {
  const guard = new RejectApiKeyGuard();

  it('rejects a request that carries an API-key principal', () => {
    const req = { apiKey: { scopes: ['advertiser:write'], advertiserId: 'adv-1', ownerId: 'owner-1' } };
    expect(() => guard.canActivate(buildContext(req))).toThrow(ForbiddenException);
  });

  it('allows a request authenticated only by JWT (no apiKey present)', () => {
    const req = { user: { sub: 'user-1' } };
    expect(guard.canActivate(buildContext(req))).toBe(true);
  });

  it('allows an unauthenticated-shaped request (downstream guards enforce auth)', () => {
    // A bare request with neither user nor apiKey should not trip THIS guard;
    // JwtAuthGuard / RolesGuard are responsible for authentication.
    expect(guard.canActivate(buildContext({}))).toBe(true);
  });
});
