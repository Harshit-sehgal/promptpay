import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * JWT path reads `req.user.role`. API-key path is more restrictive:
 * API keys are scoped to a specific owner and DO NOT elevate to admin/
 * super_admin. Routes that require admin/super_admin reject API-key auth
 * outright (returns false → 403 via RolesGuard). Routes that accept the
 * developer/advertiser/user roles let API-key-auth through and rely on
 * the scope check in ApiKeyGuard for fine-grained auth.
 *
 * For API-key auth we still require at least one scope assigned to the
 * key — a scope-less key fails closed (degenerate case).
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

    if (req.user?.role) {
      return requiredRoles.includes(req.user.role);
    }

    if (req.apiKey) {
      // Never let an API key act as admin / super_admin — that's a JWT
      // role reserved for humans performing administrative actions.
      const adminOnly = ['admin', 'super_admin'];
      if (requiredRoles.every((r) => adminOnly.includes(r))) return false;
      // For owner (developer/advertiser/user) routes, accept the API key
      // provided it has any scope assigned. Fine-grained scope checks
      // happen in ApiKeyGuard → RequiredScopes decorator.
      return req.apiKey.scopes.length > 0;
    }

    return false;
  }
}
