import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or controller) as accepting API-key authentication in
 * addition to JWT. When present, `ApiKeyGuard` will validate an `x-api-key`
 * header and populate `request.apiKey` for the handler. Routes WITHOUT this
 * decorator ignore API-key headers entirely so the guard never gates them.
 *
 * Use `@RequiredScopes(...)` on the handler to enforce scopes — the scope
 * check reads `request.apiKey.scopes` (set by ApiKeyGuard).
 */
export const ALLOW_API_KEY = 'allowApiKey';
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY, true);
