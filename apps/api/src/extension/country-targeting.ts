// Pure country-targeting helpers extracted from ExtensionService
// (issues A-056 / A-057 / #3). No database or clock dependency, so they are
// unit-testable in isolation.

export interface CountryTargetingInput {
  countryTargeting?: { countryCode: string; include: boolean }[];
}

/**
 * Normalize an ISO-3166-1 alpha-2 country code: trim + uppercase, and reject
 * anything that isn't exactly two A-Z characters. Returns undefined for
 * malformed input so callers can treat it as "unknown".
 */
export function normalizeCountryCode(country: string | null | undefined): string | undefined {
  const normalized = country?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

/**
 * Country-targeting eligibility (issue A-056). Rules:
 *  - No rules -> serve everywhere.
 *  - Only `include: true` rules -> serve only to those listed countries. An
 *    unknown developer country cannot confirm a match, so we do NOT serve.
 *  - Only `include: false` (exclude) rules -> serve everywhere except those
 *    listed. An unknown developer country is allowed (we can't confirm exclusion).
 */
export function isCountryEligible(campaign: CountryTargetingInput, userCountry?: string): boolean {
  const rules = campaign.countryTargeting;
  if (!rules || rules.length === 0) return true;
  const includes = rules.filter((r) => r.include);
  const excludes = rules.filter((r) => !r.include);
  if (includes.length > 0) {
    if (!userCountry) return false;
    return includes.some((r) => normalizeCountryCode(r.countryCode) === userCountry);
  }
  if (!userCountry) return true;
  return !excludes.some((r) => normalizeCountryCode(r.countryCode) === userCountry);
}
