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

/**
 * ISO 4217 minor-unit exponent for a currency code. Most currencies use 2
 * (cents), but 0-decimal currencies (JPY, KRW, etc.) use 0, and 3-decimal
 * currencies (BHD, KWD, TND, etc.) use 3.
 *
 * Mirrors `minorUnitExponent` in @waitlayer/shared/src/format.ts; duplicated
 * here because the CLI does not depend on the shared package.
 */
export function minorUnitExponent(currency: string): number {
  const ZERO_DECIMAL = new Set([
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'ISK',
    'JPY',
    'KMF',
    'KRW',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
  ]);
  const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
  if (ZERO_DECIMAL.has(currency.toUpperCase())) return 0;
  if (THREE_DECIMAL.has(currency.toUpperCase())) return 3;
  return 2; // default: cents
}

/** Format minor units to a display string using the currency's real exponent.
 * Previously hardcoded /100, which silently rendered JPY (0-decimal) as
 * 100x too small, BHD/KWD (3-decimal) as 10x too large, and ignored the
 * currency symbol entirely (always showed USD $). */
export function formatCurrency(minorUnits: number | string | bigint, currency = 'USD'): string {
  const exp = minorUnitExponent(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
  }).format(parseMinor(minorUnits) / 10 ** exp);
}
