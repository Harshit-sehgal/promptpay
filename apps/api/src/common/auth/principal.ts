import { UserRole } from '@waitlayer/db';

/**
 * The single, canonical identity shape attached to `req.user` for every
 * authenticated request in the API, regardless of which credential (JWT or
 * API key) authenticated it.
 *
 * Guards and downstream resolvers (e.g. `@CurrentUser`, `RolesGuard`,
 * advertiser `resolveApiContext`) must reconcile identity against `.id` only.
 * The legacy `.sub` field is retained purely for backward compatibility with
 * existing `.sub` readers and MUST NOT be used for identity reconciliation.
 */
export interface AuthenticatedPrincipal {
  id: string;
  role: UserRole;
  authMethod: 'jwt' | 'api_key';
  jti?: string;
  mfaAt?: number;
  /** Backward-compatibility alias; mirrors `id`. Never use for reconciliation. */
  sub?: string;
}
