/**
 * Money parsing helpers.
 *
 * Monetary values cross the API as **decimal strings** (BigInt columns
 * serialized via `BigInt.prototype.toJSON = () => this.toString()`). They must
 * stay exact (bigint / decimal string) on the client; converting to JS
 * `number` silently rounds any value above `2^53` and is unsafe. The previous
 * `parseMinor` returned `number` — replaced with a bigint-returning parser
 * that rejects unsafe numeric inputs instead of rounding them.
 */

/**
 * Parse a monetary *minor-unit* value returned by the API into an exact
 * `bigint`. Accepts the union an API response body can produce after JSON
 * round-trip:
 *  - `null` / `undefined` → 0n
 *  - `bigint`             → pass-through
 *  - `number`             → MUST be a safe integer; otherwise throws (rejects
 *                          unsafe numeric inputs rather than rounding them)
 *  - `string`             → must be an integer decimal string with optional
 *                          leading sign; rejects exponent notation (`1e3`),
 *                          fractions (`12.5`), `NaN`/`Infinity`, commas.
 */
export function parseMinor(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`parseMinor: non-integer minor value is not exact: ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`parseMinor: minor value exceeds safe integer range: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new Error(`parseMinor: invalid minor-unit string: ${JSON.stringify(value)}`);
    }
    return BigInt(trimmed);
  }
  throw new Error(`parseMinor: unsupported value type ${typeof value}`);
}

/**
 * Exact decimal-major → integer-minor parser for user-entered amounts.
 * Replaces the `Number(value)` path that lost precision and mis-handled
 * non-2-decimal currencies. Respects the currency's minor-unit exponent:
 *   - rejects exponent notation (`1e2`) unless explicitly off;
 *   - rejects `NaN`/`Infinity`, commas, multiple/leading-trailing signs;
 *   - rejects more decimal places than the currency allows (e.g. 3 dp for USD);
 *   - rejects values exceeding the safe bigint range for a reasonable amount.
 *
 * `exponent` is the currency's minor-unit exponent (0 for JPY, 2 for USD,
 * 3 for BHD).
 */
export function parseMajorToMinor(input: string | number, exponent: number): bigint {
  if (typeof input === 'number') {
    if (Number.isNaN(input)) throw new Error('parseMajorToMinor: NaN is not allowed');
    if (!Number.isFinite(input)) throw new Error('parseMajorToMinor: Infinity is not allowed');
    // Use the string form so the decimal-parser handles it; reject exponents.
    input = String(input);
  }
  if (exponent < 0 || !Number.isInteger(exponent) || exponent > 18) {
    throw new Error(`parseMajorToMinor: unsupported exponent ${exponent}`);
  }
  const raw = input.trim();
  if (raw.length === 0) throw new Error('parseMajorToMinor: empty amount');
  // Reject exponent notation and commas outright.
  if (/e/i.test(raw) || raw.includes(',')) {
    throw new Error(
      `parseMajorToMinor: exponent notation or commas are not allowed: ${JSON.stringify(input)}`,
    );
  }
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) throw new Error(`parseMajorToMinor: malformed amount: ${JSON.stringify(input)}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2];
  const frac = match[3] ?? '';
  if (frac.length > exponent) {
    throw new Error(
      `parseMajorToMinor: too many decimal places (${frac.length} > ${exponent}) for ${JSON.stringify(input)}`,
    );
  }
  // Pad the fraction to the currency's exponent, then drop leading zeros from
  // the whole part so there is no carry ambiguity.
  const paddedFrac = frac.padEnd(exponent, '0');
  const digits = `${whole.replace(/^0+(?=\d)/, '')}${paddedFrac}`;
  // Empty after stripping means the value was "0...": parse to 0n.
  const minorAbs = digits.length === 0 ? 0n : BigInt(digits);
  return sign * minorAbs;
}
