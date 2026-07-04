import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or controller) as accepting API-key authentication in
 * addition to JWT. When present, `ApiKeyGuard` will validate an `x-api-key`
 * header and populate `request.apiKey` for the handler. Routes WITHOUT this
 * decorator ignore API-key headers entirely so the guard never gates them.
 *
 * Pair with `@RequiredScopes(...)` to enforce that the resolved API key has
 * the requested scopes. The scope check runs inside `ApiKeyGuard` after the
 * key validates; requests lacking the required scope are rejected with 403
 * BEFORE the handler executes. JWT-only requests are never affected by
 * `@RequiredScopes` — scope is an API-key-specific authorization layer.
 */
export const ALLOW_API_KEY = 'allowApiKey';
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true);

/** Metadata key for the set of scopes required by a route. */
export const REQUIRED_API_KEY_SCOPES = 'requiredApiKeyScopes';
export const RequiredScopes = (...scopes: string[]) => SetMetadata(REQUIRED_API_KEY_SCOPES, scopes);
