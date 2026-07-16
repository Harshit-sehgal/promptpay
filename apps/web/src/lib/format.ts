import { formatMinorUnits } from '@waitlayer/shared';

/** Format minor units (cents) to display currency string.
 *  Uses the per-currency minor-unit exponent (JPY=0, USD=2, BHD=3, ...) so
 *  non-2-decimal currencies are not mis-rendered. `currency` is
 *  REQUIRED: callers must pass it explicitly so a non-USD amount
 *  can never silently render as "$" (the previous default masked
 *  multi-currency bugs). `formatCurrencyBreakdown` handles the
 *  zero/empty case below. */
export function formatCurrency(minorUnits: bigint | number, currency: string): string {
  return formatMinorUnits(BigInt(minorUnits), currency);
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

/** Format a relative time (e.g., "2d ago", "3w ago", "5mo ago") */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y ago`;
  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 30) return `${seconds}s ago`;
  return 'just now';
}
