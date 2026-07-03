import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from '../../developer/api-key.service';
import { ALLOW_API_KEY } from '../decorators/allow-api-key.decorator';

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
 * populated. The downstream controller can then use `request.apiKey.scopes`
 * or `request.apiKey.advertiserId` to scope operations.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private apiKeyService: ApiKeyService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
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
    const allowApiKey =
      this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY, [handler, cls]);
    if (!allowApiKey) {
      return true;
    }

    // If the request is already JWT-authenticated, accept the API key as
    // supplementary metadata but don't gate on it.
    if ((request as any).user) {
      return true;
    }

    try {
      const apiKey = await this.apiKeyService.validateApiKey(apiKeyHeader);
      // Attach the resolved API key info to the request for downstream use
      (request as any).apiKey = {
        id: apiKey.id,
        ownerId: apiKey.ownerId,
        advertiserId: apiKey.advertiserId,
        scopes: apiKey.scopes,
      };
      return true;
    } catch {
      return false;
    }
  }
}