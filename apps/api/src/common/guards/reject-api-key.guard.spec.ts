import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { ALLOW_API_KEY } from '../../common/decorators/allow-api-key.decorator';
import { DeveloperController } from '../../developer/developer.controller';
import { PayoutController } from '../../payout/payout.controller';
import { RejectApiKeyGuard } from './reject-api-key.guard';

/**
 * A-037: Self-service privacy/destructive write routes must be JWT-only.
 * Controllers may allow API keys at the class level for other endpoints,
 * so sensitive methods use RejectApiKeyGuard as a belt-and-suspenders backstop
 * against machine-to-machine callers.
 *
 * DeveloperController no longer carries @AllowApiKey() at all (R25) — API keys
 * are rejected by JwtAuthGuard default behavior, so RejectApiKeyGuard is not
 * needed on its methods. The class-level absence of the AllowApiKey metadata
 * flag is tested below as a stronger gate.
 */
function buildContext(req: Partial<Request>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as Parameters<RejectApiKeyGuard['canActivate']>[0];
}

describe('RejectApiKeyGuard (A-037)', () => {
  const guard = new RejectApiKeyGuard();

  it('rejects a request that carries an API-key principal', () => {
    const req = {
      apiKey: { scopes: ['advertiser:write'], advertiserId: 'adv-1', ownerId: 'owner-1' },
    };
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

describe('sensitive API-key route boundaries (A-070)', () => {
  function guardsFor(method: (...args: never[]) => unknown): unknown[] {
    return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
  }

  it('keeps payout money/destination routes JWT-only even though the controller allows API keys', () => {
    expect(guardsFor(PayoutController.prototype.addPayoutMethod)).toContain(RejectApiKeyGuard);
    expect(guardsFor(PayoutController.prototype.getPayoutInfo)).toContain(RejectApiKeyGuard);
    expect(guardsFor(PayoutController.prototype.requestPayout)).toContain(RejectApiKeyGuard);
  });

  it('keeps developer controller API-key-free — no @AllowApiKey() at class level', () => {
    // Developer endpoints are JWT-only by controller policy (R25: @AllowApiKey
    // removed from the class entirely). The absence of the AllowApiKey metadata
    // flag means JwtAuthGuard rejects API keys by default — a stronger gate
    // than per-method RejectApiKeyGuard.
    const classMeta = Reflect.getMetadata(ALLOW_API_KEY, DeveloperController);
    expect(classMeta).toBeUndefined();
  });
});
