/** Format minor units (cents) to display currency string */
export function formatCurrency(minorUnits: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/** Format grouped minor-unit totals without mixing currencies */
export function formatCurrencyBreakdown(totalsByCurrency: Record<string, number>): string {
  const entries = Object.entries(totalsByCurrency)
    .filter(([, minorUnits]) => minorUnits !== 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return formatCurrency(0);

  return entries
    .map(([currency, minorUnits]) => formatCurrency(minorUnits, currency))
    .join(' / ');
}

/** Format a number with commas */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/** Format a percentage */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Format a date to a human-friendly string */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

/** Format a relative time (e.g., "2d ago", "3h ago") */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 30) return `${seconds}s ago`;
  return 'just now';
}
