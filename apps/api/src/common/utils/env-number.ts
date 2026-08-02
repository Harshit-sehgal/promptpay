/**
 * Read a numeric environment variable with a safe fallback and hard bounds.
 *
 * A malformed (non-numeric) or out-of-range value is replaced by the fallback
 * instead of propagating `NaN` into `setInterval`/`setTimeout` (NaN fires the
 * timer immediately — a busy-loop hazard) or into money/timing arithmetic.
 * The zod boot schema validates the same variables for operators; this helper
 * is the defensive floor for the cron/timer sites that read `process.env`
 * directly, so a bad deploy manifest can never busy-loop a cron.
 */
export function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
