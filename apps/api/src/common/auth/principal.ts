import { UserRole } from '@waitlayer/db';

/**
 * The single, canonical identity shape attached to `req.user` for every
 * authenticated request in the API, regardless of which credential (JWT or
 * API key) authenticated it.
 *
 * Guards and downstream resolvers (e.g. `@CurrentUser`, `RolesGuard`,
 * advertiser `resolveApiContext`) MUST reconcile identity against `.id` only.
 * There is no `.sub` alias — JWT `sub` is the inbound token claim, not the
 * principal shape.
 */
export interface AuthenticatedPrincipal {
  id: string;
  role: UserRole;
  authMethod: 'jwt' | 'api_key';
  jti?: string;
  mfaAt?: number;
}

/**
 * Resolved advertiser request context: either the acting user (JWT) or the
 * API key's scoped advertiser (machine-to-machine). Returned by the
 * advertiser controller's `resolveApiContext` helper.
 */
export interface AdvertiserContext {
  userId: string;
  advertiserId: string | null;
  auth: 'jwt' | 'apikey';
}
