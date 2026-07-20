import * as crypto from 'crypto';

/**
 * P1.17 — detector staged rollout, stable experiment assignment, and the
 * per-source kill switch. All functions here are PURE (no VS Code / network
 * dependency) so they can be unit-tested in isolation; the extension wires
 * them to `globalState` / settings via `detector-state.ts` and `config.ts`.
 */

export type ExperimentVariant = 'control' | 'treatment';

/** The recognized heuristic detector signal sources (P1.17 / P1.18). */
export const KNOWN_DETECTOR_SOURCES = ['inactivity', 'terminal', 'task', 'editor_idle'] as const;
export type DetectorSource = (typeof KNOWN_DETECTOR_SOURCES)[number];

/**
 * Stable, deterministic hash of an id into a 0–99 bucket. SHA-256 of the id
 * (namespaced) → first 4 bytes as a uint32 → mod 100. The same id always maps
 * to the same bucket, so a user's rollout enrollment and experiment variant are
 * stable across reloads.
 */
export function hashToBucket(id: string): number {
  if (!id) return 0;
  const digest = crypto.createHash('sha256').update(`waitlayer-detector:${id}`).digest();
  return digest.readUInt32LE(0) % 100;
}

/** Whether a bucket is enrolled given a 0–100 rollout percentage. */
export function isEnrolled(bucket: number, rolloutPercent: number): boolean {
  const pct = Math.max(0, Math.min(100, Math.floor(rolloutPercent)));
  // bucket is 0–99, so default pct=100 ⇒ every bucket enrolls.
  return bucket < pct;
}

/** Deterministic variant from a bucket: even → control, odd → treatment. */
export function assignVariant(bucket: number): ExperimentVariant {
  return bucket % 2 === 0 ? 'control' : 'treatment';
}

export interface ExperimentAssignment {
  bucket: number;
  enrolled: boolean;
  variant: ExperimentVariant | null;
}

/**
 * Compute the experiment assignment for a user. Uses `userId ?? machineId` as
 * the stable identity (per the assignment spec) so a logged-in user keeps the
 * same bucket across machines while an anonymous user is stable per device.
 */
export function computeExperiment(
  userId: string | null,
  machineId: string,
  rolloutPercent: number,
): ExperimentAssignment {
  const id = userId && userId.trim() ? userId : machineId;
  const bucket = hashToBucket(id);
  const enrolled = isEnrolled(bucket, rolloutPercent);
  return { bucket, enrolled, variant: enrolled ? assignVariant(bucket) : null };
}

/** Whether a detector signal source is in the disabled set (case-insensitive). */
export function isSourceDisabled(source: string, disabled: readonly string[]): boolean {
  const normalized = source.toLowerCase();
  return disabled.some((s) => s.toLowerCase() === normalized);
}

/** Whether a false-positive suppression window is still active. */
export function isSuppressed(suppressUntil: number | undefined, now: number): boolean {
  return typeof suppressUntil === 'number' && suppressUntil > now;
}

/** Compute the suppress-until timestamp (ms) for a given duration in minutes. */
export function computeSuppressUntil(minutes: number, now: number): number {
  return now + Math.max(0, minutes) * 60_000;
}
