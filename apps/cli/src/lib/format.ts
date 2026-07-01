/** Format minor units (cents) to display string */
export function formatCurrency(minorUnits: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/** Format a number with commas */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
