import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AlertsService } from '../../observability/alerts.service';
import { AuthenticatedPrincipal } from '../auth/principal';

/**
 * Extracts a raw Bearer token from the Authorization header (no signature
 * verification). Used only to detect whether a usable JWT credential is
 * present on the request — the actual validation is delegated to the passport
 * strategy via `super.canActivate()`.
 */
function hasBearerHeader(req: { headers: Record<string, string | string | undefined> }): boolean {
  const auth = req.headers['authorization'];
  if (!auth || typeof auth !== 'string') return false;
  return auth.startsWith('Bearer ');
}

/**
 * Extracts the raw httpOnly access-token cookie value (no signature check).
 * Used only for credential-presence detection. The web app prefers the
 * host-bound `__Host-access_token` cookie (Secure + Path=/, no Domain) and
 * falls back to the bare `access_token` name as a dev/HTTP compatibility shim
 * (see JwtStrategy). Both names must be detected so a request carrying a
 * `__Host-access_token` cookie + `x-api-key` is still treated as a
 * dual-credential request and forced through JWT validation (reconciliation +
 * revocation checks).
 */
function hasAccessCookie(req: {
  cookies?: Record<string, unknown>;
  signedCookies?: Record<string, unknown>;
}): boolean {
  const src = req.cookies ?? req.signedCookies;
  if (!src) return false;
  return typeof src.access_token === 'string' || typeof src['__Host-access_token'] === 'string';
}

/**
 * JwtAuthGuard authenticates requests via the 'jwt' passport strategy
 * (Authorization header or access_token cookie → req.user).
 *
 * Routes can opt in to dual auth with `@AllowApiKey()`. When the request
 * carries BOTH a JWT credential (Bearer header / access_token cookie) AND an
 * `x-api-key`, the guard MUST still validate the JWT: the global ApiKeyGuard
 * runs before the controller-level JwtAuthGuard and stamps `req.user` from the
 * API key owner, but that synthesized user carries no `jti`/`mfaAt` and the
 * JWT's session-revocation/user-status checks would be completely bypassed.
 *
 * The guard's decision tree:
 *  1. No `req.apiKey` → delegate to passport strategy (normal JWT auth).
 *  2. `req.apiKey` set + no Bearer header / cookie → API-key-only request,
 *     `req.user` already stamped by ApiKeyGuard. Skip the JWT strategy.
 *  3. `req.apiKey` set + a JWT credential IS also present → dual-credential
 *     request. Run the JWT strategy to validate the JWT, then reconcile the
 *     passport-validated `req.user.id` against the API-key owner. If they
 *     don't match, reject — a piggybacked foreign-user JWT on an API-key
 *     request is either a misconfiguration or a replay/revocation evasion
 *     attempt.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly alerts: AlertsService) {
    super();
  }
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      apiKey?: unknown;
      headers: Record<string, string | string | undefined>;
      cookies?: Record<string, unknown>;
      signedCookies?: Record<string, unknown>;
    }>();
    // No API key → normal JWT auth.
    if (!req.apiKey) {
      return super.canActivate(context);
    }
    // API key present but no JWT credential → the key is the primary (and
    // sole) authenticator. Skip the JWT strategy so a missing Authorization
    // header doesn't trigger passport's default 401.
    if (!hasBearerHeader(req) && !hasAccessCookie(req)) {
      return true;
    }
    // Both credentials present — JWT must validate same as the API-key owner,
    // otherwise session-revocation and user-status checks are bypassed.
    return super.canActivate(context);
  }

  /**
   * When a dual-credential request passes JWT validation, reconcile: the
   * JWT-validated user ID must match the API-key owner. A foreign-user JWT
   * on an API-key request bypasses the session/user-status checks that
   * `jwt.strategy.validate` runs, exploiting the guard ordering gap.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info: any,
    context: ExecutionContext,
    status?: unknown,
  ): TUser | null {
    const jwtUser = super.handleRequest(err, user, info, context, status);
    if (!jwtUser) return jwtUser; // 401
    const req = context.switchToHttp().getRequest<{
      apiKey?: { ownerId?: string | null };
      user?: AuthenticatedPrincipal;
      url?: string;
      method?: string;
    }>();
    if (!req.apiKey) return jwtUser; // normal JWT path, no reconciliation needed
    const apiKeyOwnerId = req.apiKey.ownerId;
    // Reconcile on the canonical principal identity. The JWT-validated user
    // always carries `.id`; the legacy `.sub` field is NOT present on a
    // JWT-validated principal and must never be used for reconciliation
    // (doing so let a JWT for user A piggyback an API key for user B).
    const jwtUserId = (jwtUser as AuthenticatedPrincipal).id;
    if (apiKeyOwnerId == null || jwtUserId == null) {
      try {
        this.alerts.alertAuthIdentityMismatch({
          userId: jwtUserId,
          apiKeyOwnerId,
          path: req.url ?? '',
          reason: 'missing_canonical_identity',
        });
      } catch {
        // alerting failure must never mask the auth error
      }
      throw new UnauthorizedException(
        'Missing canonical principal identity for dual-credential request',
      );
    }
    if (String(apiKeyOwnerId) !== String(jwtUserId)) {
      try {
        this.alerts.alertAuthIdentityMismatch({
          userId: jwtUserId,
          apiKeyOwnerId,
          path: req.url ?? '',
          reason: 'identity_mismatch',
        });
      } catch {
        // alerting failure must never mask the auth error
      }
      throw new UnauthorizedException(
        'JWT identity does not match API key owner — dual-credential requests must carry a JWT for the same principal',
      );
    }
    return jwtUser;
  }
}
