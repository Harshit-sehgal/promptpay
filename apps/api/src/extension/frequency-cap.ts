// Pure frequency-cap decision logic, extracted from ExtensionService so the
// cap evaluation is unit-testable without a database (issue A-061 / #3).
// The caller computes the trailing-hour / trailing-day impression counts and
// passes them in; this function only decides whether the campaign is still
// eligible.

export interface FrequencyCapInput {
  frequencyCapPerHour?: number | null;
  frequencyCapPerDay?: number | null;
}

/**
 * Returns true when the campaign is still under both of its caps.
 * A cap of 0 or null is treated as "no cap". Pure and side-effect free.
 */
export function isUnderFrequencyCap(
  cap: FrequencyCapInput,
  hourCount: number,
  dayCount: number,
): boolean {
  if (
    cap.frequencyCapPerHour &&
    cap.frequencyCapPerHour > 0 &&
    hourCount >= cap.frequencyCapPerHour
  ) {
    return false;
  }
  if (cap.frequencyCapPerDay && cap.frequencyCapPerDay > 0 && dayCount >= cap.frequencyCapPerDay) {
    return false;
  }
  return true;
}
