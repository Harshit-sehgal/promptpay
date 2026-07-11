// Pure quiet-hours helpers extracted from ExtensionService (issue A-058 / #3).
// No database or implicit clock dependency: callers pass `now` so the logic is
// unit-testable. The timezone formatting falls back to UTC on an unknown zone
// (the settings service rejects bad timezones at write time, so this is a
// defensive safety net, not an attacker-controlled path).

export function formatHHMMInZone(now: Date, timezone = 'UTC'): string {
  const format = (tz: string): string => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    // `hour12: false` still occasionally surfaces '24' for midnight on some
    // ICU builds; coerce to '00' for clean string comparison.
    const parts = fmt.formatToParts(now);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const hh = String(Number(hour)).padStart(2, '0');
    return `${hh}:${minute}`;
  };
  try {
    return format(timezone);
  } catch {
    // Unknown timezone / runtime edge — return UTC HH:MM as a safe
    // deterministic fallback so the quiet-mode check still runs.
    return format('UTC');
  }
}

/**
 * Returns true when `now` (HH:MM 24h string) falls inside the [start, end]
 * window. When start > end the window wraps past midnight (e.g. 22:00–08:00).
 */
export function isTimeInRange(now: string, start: string, end: string): boolean {
  if (start <= end) {
    return now >= start && now <= end;
  }
  return now >= start || now <= end;
}
