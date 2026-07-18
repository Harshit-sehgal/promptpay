import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * JWT path reads `req.user.role`. API-key path is more restrictive:
 * API keys are scoped to a specific owner and DO NOT elevate to admin/
 * support/super_admin. Routes that require admin/support/super_admin reject
 * API-key auth outright (returns false → 403 via RolesGuard).
 *
 * For owner (developer/advertiser/user) routes, an API key is only authorized
 * if its OWNER role satisfies the route's required role AND the key carries at
 * least one scope. This prevents a key owned by one role from cross-accessing a
 * route scoped to a different role (e.g. an advertiser-owned key with
 * `ledger:read` must not read a developer-only `/ledger/balance`). Fine-grained
 * scope checks still happen in ApiKeyGuard → RequiredScopes decorator.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const req = context.switchToHttp().getRequest<{
      user?: { role?: string };
      apiKey?: { scopes: string[] };
    }>();

    if (req.apiKey) {
      // Never let an API key act as an elevated human role. ApiKeyGuard
      // synthesizes req.user from the key owner so handlers can still read
      // @CurrentUser('id'), therefore this API-key branch must run before
      // the JWT-style req.user branch below.
      const humanOnlyRoles = ['admin', 'support', 'super_admin'];
      if (requiredRoles.some((r) => humanOnlyRoles.includes(r))) return false;
      // For owner (developer/advertiser/user) routes, the API key's OWNER role
      // must satisfy the route's required role — a key owned by one role must
      // not cross-access a route scoped to a different role. The key must also
      // carry at least one scope; fine-grained scope checks happen in
      // ApiKeyGuard → RequiredScopes decorator.
      const ownerRole = req.user?.role;
      if (!ownerRole || !requiredRoles.includes(ownerRole)) return false;
      return req.apiKey.scopes.length > 0;
    }

    if (req.user?.role) {
      return requiredRoles.includes(req.user.role);
    }

    return false;
  }
}
