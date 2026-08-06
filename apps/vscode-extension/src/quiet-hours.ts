/** Pure quiet-hours range logic shared by the VS Code policy and scenario checks. */
export function isTimeInRange(now: string, start: string, end: string): boolean {
  if (start <= end) return now >= start && now <= end;
  // Wraps midnight, e.g. 22:00 → 08:00.
  return now >= start || now <= end;
}
