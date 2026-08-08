/**
 * Parse a pagination value that arrived as a raw query string.
 *
 * Several list endpoints read `@Query('limit') limit?: string` and hand
 * `Number(limit)` straight to the service layer. Nest's global ValidationPipe
 * does not help here — there is no DTO to validate, just a bare string — so
 * whatever the caller sent is coerced and passed on.
 *
 * The services then clamp with `Math.min(100, Math.max(1, value ?? 20))`, which
 * looks defensive and is not: `Number('abc')` is `NaN`, and **`Math.max(1, NaN)`
 * is `NaN`, `Math.min(100, NaN)` is `NaN`**. Clamping does not sanitise a
 * non-number, so `?limit=abc` reaches the query layer as `take: NaN` and
 * `skip: NaN`. `?limit=1e999` reaches it as `Infinity` by the same route.
 *
 * Parsing here means the clamp downstream only ever sees a real integer, and a
 * nonsense value falls back to the endpoint's default instead of becoming a
 * failure deep in the data layer where the cause is no longer visible.
 */
export function parsePaginationParam(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;

  const value = Number(raw);
  // Rejects NaN and ±Infinity in one check; `Number.isFinite` is deliberate
  // rather than the global `isFinite`, which coerces its argument.
  if (!Number.isFinite(value)) return undefined;

  const asInt = Math.trunc(value);
  // A zero or negative page/limit is meaningless. Returning `undefined` hands
  // the endpoint's own default back rather than inventing a value here, which
  // keeps each endpoint's default in one place.
  if (asInt < 1) return undefined;

  // Beyond this a value is not a real request, and letting it through only
  // gives the clamp a larger number to discard. Postgres integer range is the
  // natural ceiling.
  return Math.min(asInt, 2_147_483_647);
}
