import type * as vscode from 'vscode';

import { computeExperiment, type ExperimentAssignment, isSuppressed } from './detector-policy';

const EXPERIMENT_KEY = 'waitlayer.detectorExperiment';
const SUPPRESS_KEY = 'waitlayer.falsePositiveSuppressUntil';

/**
 * Persisted detector state — the stable experiment assignment (P1.17) and the
 * false-positive suppression window (P1.18) — backed by VS Code `globalState`
 * (a Memento) so it survives extension reloads.
 */
export class DetectorState {
  constructor(private readonly globalState: vscode.Memento) {}

  /**
   * Return the user's experiment assignment, persisting the variant the first
   * time an enrolled user is seen so it stays stable across reloads (even if
   * `rolloutPercent` later changes). Non-enrolled users are not persisted.
   */
  getOrAssignExperiment(
    userId: string | null,
    machineId: string,
    rolloutPercent: number,
  ): ExperimentAssignment {
    const assignment = computeExperiment(userId, machineId, rolloutPercent);
    if (assignment.enrolled && assignment.variant) {
      const existing = this.globalState.get<ExperimentAssignment>(EXPERIMENT_KEY);
      if (!existing || existing.variant == null) {
        void this.globalState.update(EXPERIMENT_KEY, assignment);
      } else {
        return existing;
      }
    }
    return assignment;
  }

  getExperiment(): ExperimentAssignment | undefined {
    return this.globalState.get<ExperimentAssignment>(EXPERIMENT_KEY);
  }

  getSuppressUntil(): number | undefined {
    return this.globalState.get<number>(SUPPRESS_KEY);
  }

  setSuppressUntil(ts: number | undefined): void {
    void this.globalState.update(SUPPRESS_KEY, ts);
  }

  clearSuppression(): void {
    void this.globalState.update(SUPPRESS_KEY, undefined);
  }

  /** True while a false-positive suppression window is active (P1.18). */
  isSuppressed(now: number): boolean {
    return isSuppressed(this.getSuppressUntil(), now);
  }
}
