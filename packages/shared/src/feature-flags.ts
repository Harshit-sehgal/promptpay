/**
 * Simple environment-based feature flags.
 *
 * Flags are read from `process.env` at runtime. The convention is
 * `FEATURE_<NAME>=true|false` (case-insensitive). Unknown or missing values
 * fall back to the default provided at the call site.
 *
 * This is intentionally lightweight — no external service, no database
 * table, no UI toggles. It gives the codebase a single place to gate
 * experimental or risky behaviour behind an env var that operators can
 * flip at deploy time without a code change.
 */

const FLAG_PREFIX = 'FEATURE_';

function flagKey(name: string): string {
  return `${FLAG_PREFIX}${name.toUpperCase()}`;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

/**
 * Check whether a feature flag is enabled.
 *
 * @param name Flag name without the `FEATURE_` prefix.
 * @param defaultValue Value to return when the flag is unset.
 */
export function isEnabled(name: string, defaultValue = false): boolean {
  return parseBool(process.env[flagKey(name)], defaultValue);
}

/**
 * Check whether a feature flag is disabled.
 *
 * A flag is considered disabled when it is explicitly set to `false`, `0`,
 * `no`, or `off`. When the flag is unset, `defaultValue` is returned.
 *
 * @param name Flag name without the `FEATURE_` prefix.
 * @param defaultValue Value to return when the flag is unset.
 */
export function isDisabled(name: string, defaultValue = false): boolean {
  return !isEnabled(name, !defaultValue);
}

/**
 * Read a feature flag as a string.
 *
 * @param name Flag name without the `FEATURE_` prefix.
 * @param defaultValue Value to return when the flag is unset.
 */
export function getString(name: string, defaultValue?: string): string | undefined {
  const value = process.env[flagKey(name)];
  return value === undefined || value === '' ? defaultValue : value;
}

/**
 * Read a feature flag as a number.
 *
 * @param name Flag name without the `FEATURE_` prefix.
 * @param defaultValue Value to return when the flag is unset or invalid.
 */
export function getNumber(name: string, defaultValue: number): number {
  const value = process.env[flagKey(name)];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * List all feature flags currently set in the environment.
 * Useful for startup logging and debugging.
 */
export function listFlags(): Record<string, string | undefined> {
  const flags: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(FLAG_PREFIX)) {
      flags[key] = value;
    }
  }
  return flags;
}
