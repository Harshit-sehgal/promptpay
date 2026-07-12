import { parseMinor } from '@waitlayer/shared';

/**
 * Format minor units (cents) to display string.
 * Use `formatMinorUnits` from @waitlayer/shared for currency-aware formatting;
 * this legacy helper remains for the CLI revenue-spend display which is always
 * USD and uses percentage-like formatting.
 */
export function formatCurrency(minorUnits: number | string | bigint, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(parseMinor(minorUnits) / 100);
}
