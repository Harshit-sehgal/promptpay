import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

/** The JWT-validated principal (as produced by JwtStrategy.validate). */
function jwtUser(id: string) {
  return { id, role: 'developer', authMethod: 'jwt' as const };
}

describe('JwtAuthGuard.handleRequest — dual-credential reconciliation', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();
    guard = moduleRef.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('throws when the API-key owner differs from the JWT principal', () => {
    const ctx = makeContext({
      apiKey: { ownerId: 'B' },
      user: { id: 'A', role: 'developer', authMethod: 'jwt' },
    });

    expect(() => guard.handleRequest(null, jwtUser('A'), null, ctx)).toThrow(UnauthorizedException);
  });

  it('returns the user when the API-key owner matches the JWT principal', () => {
    const ctx = makeContext({
      apiKey: { ownerId: 'A' },
      user: { id: 'A', role: 'developer', authMethod: 'jwt' },
    });

    const result = guard.handleRequest(null, jwtUser('A'), null, ctx);
    expect(result).toEqual(jwtUser('A'));
  });

  it('throws when the dual-credential request has an ambiguous (missing) principal', () => {
    const ctx = makeContext({
      apiKey: { ownerId: null },
      user: { id: 'A', role: 'developer', authMethod: 'jwt' },
    });

    expect(() => guard.handleRequest(null, jwtUser('A'), null, ctx)).toThrow(
      new UnauthorizedException('Missing canonical principal identity for dual-credential request'),
    );
  });

  it('skips reconciliation when no API key is present (normal JWT path)', () => {
    const ctx = makeContext({
      user: { id: 'A', role: 'developer', authMethod: 'jwt' },
    });

    const result = guard.handleRequest(null, jwtUser('A'), null, ctx);
    expect(result).toEqual(jwtUser('A'));
  });
});
