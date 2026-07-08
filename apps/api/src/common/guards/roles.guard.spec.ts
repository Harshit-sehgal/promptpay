import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from './roles.guard';

function guard(requiredRoles?: string[]) {
  return new RolesGuard({
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector);
}

function context(request: { user?: { role?: string }; apiKey?: { scopes: string[] } }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows routes without role metadata', () => {
    expect(guard().canActivate(context({}))).toBe(true);
  });

  it('allows matching JWT roles and rejects mismatched JWT roles', () => {
    expect(guard(['developer']).canActivate(context({ user: { role: 'developer' } }))).toBe(true);
    expect(guard(['advertiser']).canActivate(context({ user: { role: 'developer' } }))).toBe(false);
  });

  it('uses API-key authorization before synthesized req.user roles', () => {
    expect(
      guard(['advertiser']).canActivate(
        context({
          apiKey: { scopes: ['campaigns:write'] },
          user: { role: 'developer' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects API-key access to elevated human roles', () => {
    for (const role of ['admin', 'support', 'super_admin']) {
      expect(
        guard([role]).canActivate(
          context({
            apiKey: { scopes: ['reports:read'] },
            user: { role: 'developer' },
          }),
        ),
      ).toBe(false);
    }
  });

  it('rejects scope-less API keys on role-gated routes', () => {
    expect(
      guard(['developer']).canActivate(
        context({
          apiKey: { scopes: [] },
          user: { role: 'developer' },
        }),
      ),
    ).toBe(false);
  });
});
