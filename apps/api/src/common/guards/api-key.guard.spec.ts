import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyGuard } from './api-key.guard';
import { ALLOW_API_KEY, REQUIRED_API_KEY_SCOPES } from '../decorators/allow-api-key.decorator';

interface RequestLike {
  headers: Record<string, string | undefined>;
  user?: Record<string, unknown>;
  apiKey?: { id: string; ownerId: string | null; advertiserId: string | null; scopes: string[] };
}

function makeContext(
  header: string | undefined,
  allowApiKey: boolean,
  requiredScopes: string[] | undefined,
  user?: Record<string, unknown>,
): { guard: ApiKeyGuard; request: RequestLike } {
  const apiKeyService = {
    validateApiKey: vi.fn(),
  };
  const reflector = {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === ALLOW_API_KEY) return allowApiKey;
      if (key === REQUIRED_API_KEY_SCOPES) return requiredScopes;
      return undefined;
    }),
  };

  const request: RequestLike = { headers: {}, user };
  if (header !== undefined) request.headers['x-api-key'] = header;

  const guard = new ApiKeyGuard(apiKeyService as any, reflector as any);
  return { guard, request };
}

function contextFrom(guard: ApiKeyGuard, request: RequestLike): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard scope resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets non-API-key requests through without validating a key', async () => {
    const { guard, request } = makeContext(undefined, true, undefined);

    await expect(guard.canActivate(contextFrom(guard, request))).resolves.toBe(true);
    expect(request.apiKey).toBeUndefined();
    // No x-api-key header means the service is never consulted.
    expect((guard as any).apiKeyService.validateApiKey).not.toHaveBeenCalled();
  });

  it('ignores x-api-key header on routes that are not opted-in (@AllowApiKey)', async () => {
    const { guard, request } = makeContext('wlk_test_key', false, undefined);

    await expect(guard.canActivate(contextFrom(guard, request))).resolves.toBe(true);
    expect(request.apiKey).toBeUndefined();
    expect((guard as any).apiKeyService.validateApiKey).not.toHaveBeenCalled();
  });

  it('validates the key and populates req.apiKey when opted-in', async () => {
    const { guard, request } = makeContext('wlk_test_key', true, undefined);
    (guard as any).apiKeyService.validateApiKey.mockResolvedValue({
      id: 'key_1',
      ownerId: 'owner_1',
      advertiserId: 'adv_1',
      scopes: ['campaigns:read'],
      owner: { role: 'advertiser' },
    });

    await expect(guard.canActivate(contextFrom(guard, request))).resolves.toBe(true);
    expect(request.apiKey).toMatchObject({
      id: 'key_1',
      ownerId: 'owner_1',
      scopes: ['campaigns:read'],
    });
    // Synthesized owner identity so @CurrentUser resolves uniformly with JWT.
    expect(request.user).toMatchObject({ id: 'owner_1', role: 'advertiser' });
  });

  it('allows the request when all required scopes are present', async () => {
    const { guard, request } = makeContext('wlk_test_key', true, ['campaigns:write', 'reports:read']);
    (guard as any).apiKeyService.validateApiKey.mockResolvedValue({
      id: 'key_1',
      ownerId: 'owner_1',
      advertiserId: null,
      scopes: ['campaigns:write', 'reports:read', 'billing:read'],
      owner: { role: 'advertiser' },
    });

    await expect(guard.canActivate(contextFrom(guard, request))).resolves.toBe(true);
  });

  it('rejects with 403 when the key is missing a required scope', async () => {
    const { guard, request } = makeContext('wlk_test_key', true, ['campaigns:write']);
    (guard as any).apiKeyService.validateApiKey.mockResolvedValue({
      id: 'key_1',
      ownerId: 'owner_1',
      advertiserId: null,
      scopes: ['reports:read'],
      owner: { role: 'advertiser' },
    });

    await expect(guard.canActivate(contextFrom(guard, request))).rejects.toThrow(
      /missing required scope/,
    );
  });

  it('does not gate on scopes when the request is already JWT-authenticated', async () => {
    const { guard, request } = makeContext('wlk_test_key', true, ['campaigns:write'], {
      id: 'jwt_user',
      role: 'advertiser',
    });
    (guard as any).apiKeyService.validateApiKey.mockResolvedValue({
      id: 'key_1',
      ownerId: 'owner_1',
      advertiserId: null,
      scopes: [],
      owner: { role: 'advertiser' },
    });

    await expect(guard.canActivate(contextFrom(guard, request))).resolves.toBe(true);
    expect((guard as any).apiKeyService.validateApiKey).not.toHaveBeenCalled();
  });
});
