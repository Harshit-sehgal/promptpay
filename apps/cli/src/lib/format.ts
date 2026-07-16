/**
 * Parse a monetary minor-unit value returned by the API. The API serializes
 * BigInt monetary columns as strings (e.g. "1234") to preserve precision;
 * clients that perform arithmetic need an integer value.
 *
 * Handles the union types that an API response body can produce after JSON
 * serialise/deserialize:
 *   - `null` / `undefined` → 0
 *   - `bigint` (direct value, e.g. test fixture) → pass through
 *   - `number` (only a safe integer) → BigInt
 *   - `string` (BigInt-to-JSON serialization) → BigInt, with invalid → 0 guard
 */
export function parseMinor(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        'Minor-unit numbers must be safe integers; pass an exact decimal string',
      );
    }
    return BigInt(value);
  }
  return /^-?\d+$/.test(value) ? BigInt(value) : 0n;
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
  const amountMinor = parseMinor(minorUnits);
  const negative = amountMinor < 0n;
  const absolute = negative ? -amountMinor : amountMinor;
  const factor = 10n ** BigInt(exp);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(exp, '0');
  const groupedWhole = new Intl.NumberFormat('en-US', {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(whole);
  const exactNumber = `${groupedWhole}${exp > 0 ? `.${fraction}` : ''}`;
  const parts = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).formatToParts(negative ? -1 : 1);
  const numericParts = new Set(['integer', 'group', 'decimal', 'fraction']);
  let insertedNumber = false;

  return parts
    .map((part) => {
      if (!numericParts.has(part.type)) return part.value;
      if (insertedNumber) return '';
      insertedNumber = true;
      return exactNumber;
    })
    .join('');
}
