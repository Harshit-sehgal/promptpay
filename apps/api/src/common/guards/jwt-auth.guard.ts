import { ExecutionContext,Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JwtAuthGuard authenticates requests via the 'jwt' passport strategy
 * (Authorization header or access_token cookie → req.user).
 *
 * Routes can opt in to dual auth with `@AllowApiKey()`. When an API key is
 * the PRIMARY credential (no JWT present), the global ApiKeyGuard runs first:
 * it validates the key, enforces required scopes, and stamps `req.apiKey`.
 * In that case there is nothing for the jwt strategy to do — but the default
 * `AuthGuard.handleRequest` throws 401 when passport's verify callback returns
 * `null` (no Authorization header + no cookie). That would make API-key-only
 * auth unreachable on every controller that stacks `@UseGuards(JwtAuthGuard)`
 * with `@AllowApiKey()`.
 *
 * Override `handleRequest` to pass through when an API key has already
 * authenticated the request. JwtAuthGuard still runs and still throws on a
 * truly unauthenticated request (no JWT, no API key). RolesGuard downstream
 * separately inspects `req.apiKey` to keep API keys off admin routes, and the
 * handlers read identity from `req.apiKey` / `req.user` as appropriate.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      apiKey?: unknown;
      headers: Record<string, string | string | undefined>;
    }>();
    // If an API key is the primary credential, ApiKeyGuard already validated
    // it and set req.apiKey — skip jwt strategy execution entirely so a
    // missing Authorization header doesn't 401 the request.
    if (req.apiKey) {
      return true;
    }
    return super.canActivate(context);
  }
}
