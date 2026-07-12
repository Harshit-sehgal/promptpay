/**
 * Parse a monetary minor-unit value returned by the API. The API serializes
 * BigInt monetary columns as decimal strings (e.g. "1234") to preserve
 * precision; clients that perform arithmetic need a numeric value.
 *
 * Handles the union types that an API response body can produce after JSON
 * serialise/deserialize:
 *   - `null` / `undefined` → 0
 *   - `bigint` (direct value, e.g. test fixture) → Number
 *   - `number` (already a safe integer) → pass through
 *   - `string` (BigInt-to-JSON serialization) → Number, with NaN → 0 guard
 */
export function parseMinor(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
