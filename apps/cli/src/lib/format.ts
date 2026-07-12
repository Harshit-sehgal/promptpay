/**
 * Parse a monetary minor-unit value returned by the API. The API serializes
 * BigInt monetary columns as strings (e.g. "1234") to preserve precision;
 * clients that perform arithmetic need a numeric value.
 *
 * Handles the union types that an API response body can produce after JSON
 * serialise/deserialize:
 *   - `null` / `undefined` → 0
 *   - `bigint` (direct value, e.g. test fixture) → Number
 *   - `number` (already a safe integer) → pass through
 *   - `string` (BigInt-to-JSON serialization) → Number, with NaN → 0 guard
 *
 * Mirrors `parseMinor` in @waitlayer/shared/src/parse.ts; duplicated here
 * because the CLI does not depend on the shared package.
 */
export function parseMinor(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Format minor units (cents) to display string */
export function formatCurrency(minorUnits: number | string | bigint, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(parseMinor(minorUnits) / 100);
}
