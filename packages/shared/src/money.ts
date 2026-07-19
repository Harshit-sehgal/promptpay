import { formatMinorUnits, isSupportedCurrency } from './currency';
import { parseMinor } from './parse';

/**
 * A monetary value bound to a single currency.
 *
 * Money is never passed as a bare `bigint` plus a loose `currency: string`
 * pair, because that pairing is easy to split apart and combine across
 * currencies by accident. A `Money` value can only be combined with another
 * `Money` of the *same* currency; crossing currencies requires an explicit,
 * rate-sourced {@link ConversionQuote} via {@link convertMoney}.
 */
export type SupportedCurrency = string;

export interface Money {
  amountMinor: bigint;
  currency: SupportedCurrency;
}

/** Throws when the two currencies differ — the core guard for this module. */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(
      `cross-currency operation rejected: ${a.currency} vs ${b.currency} (use convertMoney with an explicit quote)`,
    );
  }
}

function requireSupported(currency: SupportedCurrency): void {
  if (!isSupportedCurrency(currency)) {
    throw new Error(`unsupported currency: ${JSON.stringify(currency)}`);
  }
}

export function zeroMoney(currency: SupportedCurrency): Money {
  requireSupported(currency);
  return { amountMinor: 0n, currency };
}

/** Same-currency addition. Throws on currency mismatch. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

/** Same-currency subtraction. Throws on currency mismatch. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

/**
 * Compare two same-currency values. Returns -1, 0, or 1. Throws on mismatch.
 */
export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

export function isPositiveMoney(m: Money): boolean {
  return m.amountMinor > 0n;
}

/** Throws unless the amount is a positive (non-zero) minor-unit value. */
export function validatePositiveMoney(m: Money): void {
  requireSupported(m.currency);
  if (m.amountMinor <= 0n) {
    throw new Error(`money amount must be positive: ${m.amountMinor} ${m.currency}`);
  }
}

export function isZeroMoney(m: Money): boolean {
  return m.amountMinor === 0n;
}

/** Serialize for JSON transport — `amountMinor` becomes a decimal string. */
export function serializeMoney(m: Money): { amountMinor: string; currency: SupportedCurrency } {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

/** Inverse of {@link serializeMoney}; parses the string back to bigint. */
export function deserializeMoney(json: {
  amountMinor: string | number | bigint;
  currency: SupportedCurrency;
}): Money {
  const amountMinor = parseMinor(json.amountMinor);
  requireSupported(json.currency);
  return { amountMinor, currency: json.currency };
}

/** Display string respecting the currency's minor-unit exponent. */
export function formatMoney(m: Money): string {
  return formatMinorUnits(m.amountMinor, m.currency);
}

/**
 * An explicit, rate-sourced conversion between two currencies.
 *
 * `rateMinor` is the amount of `to` minor units payable per `denominator`
 * minor units of `from`. Storing the ratio as integers (rather than a float)
 * keeps the conversion exact and auditable. The `source` and `timestamp`
 * fields make every conversion traceable.
 */
export interface ConversionQuote {
  from: SupportedCurrency;
  to: SupportedCurrency;
  rateMinor: bigint;
  denominator: bigint;
  source: string;
  timestamp: number;
}

/**
 * Apply a {@link ConversionQuote}, returning a new `Money` in `quote.to`.
 * The input is never mutated (immutable conversion). Throws if the money's
 * currency is not `quote.from`.
 */
export function convertMoney(m: Money, quote: ConversionQuote): Money {
  if (m.currency !== quote.from) {
    throw new Error(`conversion quote is for ${quote.from} but money is in ${m.currency}`);
  }
  if (quote.denominator <= 0n) {
    throw new Error(`conversion denominator must be positive: ${quote.denominator}`);
  }
  requireSupported(quote.to);
  const converted = (m.amountMinor * quote.rateMinor) / quote.denominator;
  return { amountMinor: converted, currency: quote.to };
}
