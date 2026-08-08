import { formatMinorUnits } from '@waitlayer/shared';

/** Re-export the shared exact minor-unit formatter so web components get all
 * money formatting from one module. */
export { formatMinorUnits };

/** Format minor units (cents) to display currency string.
 *  Uses the per-currency minor-unit exponent (JPY=0, USD=2, BHD=3, ...) so
 *  non-2-decimal currencies are not mis-rendered. `currency` is
 *  REQUIRED: callers must pass it explicitly so a non-USD amount
 *  can never silently render as "$" (the previous default masked
 *  multi-currency bugs). `formatCurrencyBreakdown` handles the
 *  zero/empty case below. */
export function formatCurrency(minorUnits: bigint | number, currency: string): string {
  // Fail soft on malformed display values: an unexpected null/NaN/non-safe
  // number from a drifted API shape must render "$0.00" instead of throwing
  // and blanking the whole page. The authoritative numbers live on the
  // byCurrency maps; this is a render-layer guard, not a data correction.
  let minor = 0n;
  try {
    if (typeof minorUnits === 'bigint') {
      minor = minorUnits;
    } else if (Number.isSafeInteger(minorUnits)) {
      minor = BigInt(minorUnits);
    }
  } catch {
    minor = 0n;
  }
  return formatMinorUnits(minor, currency);
}

/** Format grouped minor-unit totals without mixing currencies */
export function formatCurrencyBreakdown(totalsByCurrency: Record<string, bigint | number>): string {
  const entries = Object.entries(totalsByCurrency)
    .filter(([, minorUnits]) => minorUnits !== 0 && minorUnits !== 0n)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return formatCurrency(0, 'USD');

  return entries.map(([currency, minorUnits]) => formatCurrency(minorUnits, currency)).join(' / ');
}

/** Format a number with commas */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/** Format a percentage */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Calculate a percentage without first narrowing 64-bit monetary values to a
 * JavaScript number. The result is rounded to `decimals` and only the bounded
 * display percentage crosses the bigint -> number boundary.
 */
export function bigintRatioPercent(
  numerator: bigint | number,
  denominator: bigint | number,
  decimals = 1,
): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new RangeError('decimals must be an integer between 0 and 6');
  }

  const numeratorBigInt = BigInt(numerator);
  const denominatorBigInt = BigInt(denominator);
  if (numeratorBigInt <= 0n || denominatorBigInt <= 0n) return 0;

  const decimalScale = 10n ** BigInt(decimals);
  const rounded =
    (numeratorBigInt * 100n * decimalScale + denominatorBigInt / 2n) / denominatorBigInt;
  return Number(rounded) / Number(decimalScale);
}

/** Format a date to a human-friendly string */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

/**
 * Format a relative time, in either direction (e.g. "2d ago", "in 7d").
 *
 * FUTURE dates are the reason this handles both. Every branch below tests
 * `> 0`, so a future timestamp made all of them fail and fell through to
 * "just now". That is not cosmetic: the developer earnings table renders
 * `availableAt` under a column headed "Available", and the API sets it to
 * `Date.now() + holdDays` — always in the future while an entry is held. A
 * developer saw "just now" against money locked for days, requested a payout,
 * and was refused with no explanation the UI had given them.
 *
 * An unparseable date returns an em dash rather than "just now", which is the
 * same distinction: absence of information should not render as a confident
 * statement about the present.
 */
export function formatRelativeTime(date: string | Date): string {
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return '—';

  const diffMs = Date.now() - then;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  const say = (value: number, unit: string) => (future ? `in ${value}${unit}` : `${value}${unit} ago`);

  if (years > 0) return say(years, 'y');
  if (months > 0) return say(months, 'mo');
  if (weeks > 0) return say(weeks, 'w');
  if (days > 0) return say(days, 'd');
  if (hours > 0) return say(hours, 'h');
  if (minutes > 0) return say(minutes, 'm');
  if (seconds > 30) return say(seconds, 's');
  return 'just now';
}
