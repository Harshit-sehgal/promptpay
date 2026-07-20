import { Request } from 'express';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '@waitlayer/db';

import { ApiKeyService } from '../../developer/api-key.service';
import { ALLOW_API_KEY, REQUIRED_API_KEY_SCOPES } from '../decorators/allow-api-key.decorator';

interface RequestWithOptionalUser extends Request {
  user?: Record<string, unknown>;
  apiKey?: {
    id: string;
    ownerId: string | null;
    advertiserId: string | null;
    scopes: string[];
  };
}

/**
 * When an API key is the PRIMARY credential (no JWT), synthesize a minimal
 * `req.user` so downstream `@CurrentUser('id')` / `@CurrentUser('role')` and
 * `RolesGuard` resolve the *owner's* identity uniformly — the same shape the
 * JWT strategy produces. Without this, every `@AllowApiKey` controller that
 * reads `@CurrentUser('id')` would receive `undefined` (JwtAuthGuard skips jwt
 * strategy execution when req.apiKey is set, so passport never populates
 * req.user), and Prisma then omits the `undefined` userId from every WHERE
 * clause → cross-tenant data leak (earnings/payout/developer exports).
 *
 * The synthesized user carries the owner's id and role (resolved in
 * validateApiKey) so `@CurrentUser('id')` / `RolesGuard` resolve the owner
 * uniformly. `advertiserId` from the key stays available on `req.apiKey` for
 * routes that need the key's *scoped* advertiser rather than the owner's own
 * profile (advertiser controller).
 */
function stampUserFromApiKey(
  req: RequestWithOptionalUser,
  apiKey: {
    ownerId: string;
    owner: { role: string };
  },
): void {
  req.user = {
    id: apiKey.ownerId,
    role: apiKey.owner.role as UserRole,
    authMethod: 'api_key' as const,
  } as Record<string, unknown>;
}

/**
 * ApiKeyGuard authenticates requests bearing an `x-api-key` header.
 *
 * Because this guard runs as a global APP_GUARD alongside JwtAuthGuard it
 * MUST NOT reject requests that are already JWT-authenticated. The guard
 * exits with `true` ("let it through") when:
 *   - No `x-api-key` header is present — the request is JWT-authenticated
 *     and will be handled by JwtAuthGuard later in the chain.
 *   - Or the route is NOT explicitly marked with `@AllowApiKey()` — the
 *     guard is present for every route but only acts when opted-in.
 *   - Or the request is ALREADY authenticated by JwtAuthGuard (request.user
 *     is set). In that case the API key is accepted as supplementary metadata
 *     (e.g. to scope scenes for an advertiser's personal API key) but auth
 *     already happened.
 *
 * When an `x-api-key` header is present AND the route is opted-in AND the
 * request has no JWT user, the key is validated and `request.apiKey` is
 * populated. If the route is also marked `@RequiredScopes(...)`, the
 * resolved key's scopes must cover every required scope — otherwise the
 * request is rejected with 403 (scope is conceptually an authorization
 * layer, not authentication).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private apiKeyService: ApiKeyService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOptionalUser>();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    // No API-key header → not our concern; let JwtAuthGuard handle it.
    if (!apiKeyHeader) {
      return true;
    }

    // If the route is not opted-in, ignore the header (don't reject).
    // This prevents an unauthed attacker sending x-api-key to a JWT-only
    // route and getting denied (which leaks the route-existence signal).
    const handler = context.getHandler();
    const cls = context.getClass();
    const allowApiKey = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY, [handler, cls]);
    if (!allowApiKey) {
      return true;
    }

    // If the request is already JWT-authenticated, accept the API key as
    // supplementary metadata but don't gate on it. Scopes only apply when
    // the API key is the *primary* credential for the request.
    if (request.user) {
      return true;
    }

    const apiKey = await this.apiKeyService.validateApiKey(apiKeyHeader);
    // Attach the resolved API key info to the request for downstream use
    request.apiKey = {
      id: apiKey.id,
      ownerId: apiKey.ownerId,
      advertiserId: apiKey.advertiserId,
      scopes: apiKey.scopes,
    };

    // Synthesize req.user from the key owner so `@CurrentUser('id')` /
    // `@CurrentUser('role')` and RolesGuard resolve the owner uniformly.
    // Without this, handlers reading `@CurrentUser('id')` receive `undefined`
    // (JwtAuthGuard skips the jwt strategy when req.apiKey is set) and the
    // undefined filters out of Prisma WHERE clauses → cross-tenant leaks.
    if (apiKey.ownerId && apiKey.owner) {
      stampUserFromApiKey(request, {
        ownerId: apiKey.ownerId,
        owner: { role: apiKey.owner.role },
      });
    }

    // Scope enforcement — runs ONLY when the API key is the primary credential.
    // The handler-side decorator declares the required scopes; the resolved
    // key's scopes must include all of them (logical AND). Without a scope on
    // the route, every key pass-through is allowed (the route opts-in via
    // @AllowApiKey but doesn't restrict which keys; useful for routes that
    // just need a valid key to be present).
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_API_KEY_SCOPES, [
      handler,
      cls,
    ]);
    if (requiredScopes && requiredScopes.length > 0) {
      const have = new Set(apiKey.scopes);
      const missing = requiredScopes.filter((s) => !have.has(s));
      if (missing.length > 0) {
        throw new ForbiddenException(`API key missing required scope(s): ${missing.join(', ')}`);
      }
    }

    return true;
  }
}
