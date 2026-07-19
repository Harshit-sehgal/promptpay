import type { LabelledSample } from './detector-quality';

/**
 * Versioned sample labelled corpus for the detector-quality system (P1.16).
 *
 * This is a real, curated ground-truth set used by the unit tests and as a
 * seed for the off-line quality dashboard. It is intentionally small and
 * hand-labelled: each row records what the user was *actually* doing
 * (`groundTruth`) versus what the detector emitted (`predicted`), with timing
 * so latency and ad-too-late can be measured. Production accuracy is measured
 * the same way against a much larger corpus exported from the extension's
 * shadow-mode telemetry.
 *
 * Conventions:
 *  - timestamps are monotonic ms; `detectionMs`/`adShownMs` omitted when N/A.
 *  - `groundTruth: 'human'` means the user was actively working and the wait
 *    should NOT have been monetized (a detector emission here is a false positive).
 */
export const SAMPLE_LABELLED_DATASET: LabelledSample[] = [
  // ── vscode, 1.4.2 ───────────────────────────────────────────────────────
  {
    id: 'vs-01',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'ai_generation',
    predicted: 'ai_generation',
    waitStartMs: 1000,
    detectionMs: 1600,
    adEligibleMs: 1600,
    adShownMs: 1800,
  },
  {
    id: 'vs-02',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'ai_generation',
    predicted: 'ai_generation',
    waitStartMs: 2000,
    detectionMs: 2300,
    adEligibleMs: 2300,
    adShownMs: 2400,
  },
  {
    id: 'vs-03',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'inactivity',
    predicted: 'inactivity',
    waitStartMs: 3000,
    detectionMs: 4500,
    adEligibleMs: 4500,
    adShownMs: 9000,
  }, // ad too late (>5s)
  {
    id: 'vs-04',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'ai_generation',
    predicted: null,
    waitStartMs: 4000,
    adEligibleMs: 4600,
  }, // missed -> FN
  {
    id: 'vs-05',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'human',
    predicted: null,
    waitStartMs: 5000,
  }, // TN
  {
    id: 'vs-06',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'human',
    predicted: 'ai_generation',
    waitStartMs: 6000,
  }, // FP
  {
    id: 'vs-07',
    tool: 'vscode',
    detectorVersion: '1.4.2',
    groundTruth: 'editor_switch',
    predicted: 'editor_switch',
    waitStartMs: 7000,
    detectionMs: 7200,
    adEligibleMs: 7200,
    adShownMs: 7300,
  },

  // ── claude-code, 1.4.2 ─────────────────────────────────────────────────
  {
    id: 'cc-01',
    tool: 'claude-code',
    detectorVersion: '1.4.2',
    groundTruth: 'ai_generation',
    predicted: 'ai_generation',
    waitStartMs: 1000,
    detectionMs: 1400,
    adEligibleMs: 1400,
    adShownMs: 1600,
  },
  {
    id: 'cc-02',
    tool: 'claude-code',
    detectorVersion: '1.4.2',
    groundTruth: 'terminal',
    predicted: 'terminal',
    waitStartMs: 2000,
    detectionMs: 2500,
    adEligibleMs: 2500,
    adShownMs: 2700,
  },
  {
    id: 'cc-03',
    tool: 'claude-code',
    detectorVersion: '1.4.2',
    groundTruth: 'ai_generation',
    predicted: null,
    waitStartMs: 3000,
    adEligibleMs: 3600,
  }, // FN
  {
    id: 'cc-04',
    tool: 'claude-code',
    detectorVersion: '1.4.2',
    groundTruth: 'human',
    predicted: null,
    waitStartMs: 4000,
  }, // TN
  {
    id: 'cc-05',
    tool: 'claude-code',
    detectorVersion: '1.4.2',
    groundTruth: 'task',
    predicted: 'task',
    waitStartMs: 5000,
    detectionMs: 5400,
    adEligibleMs: 5400,
    adShownMs: 5600,
  },

  // ── cursor, 1.4.1 ──────────────────────────────────────────────────────
  {
    id: 'cu-01',
    tool: 'cursor',
    detectorVersion: '1.4.1',
    groundTruth: 'ai_generation',
    predicted: 'ai_generation',
    waitStartMs: 1000,
    detectionMs: 1900,
    adEligibleMs: 1900,
    adShownMs: 2100,
  },
  {
    id: 'cu-02',
    tool: 'cursor',
    detectorVersion: '1.4.1',
    groundTruth: 'ai_generation',
    predicted: 'ai_generation',
    waitStartMs: 2000,
    detectionMs: 2200,
    adEligibleMs: 2200,
    adShownMs: 2300,
  },
  {
    id: 'cu-03',
    tool: 'cursor',
    detectorVersion: '1.4.1',
    groundTruth: 'inactivity',
    predicted: null,
    waitStartMs: 3000,
    adEligibleMs: 4500,
  }, // FN (inactivity weak, shadow)
  {
    id: 'cu-04',
    tool: 'cursor',
    detectorVersion: '1.4.1',
    groundTruth: 'human',
    predicted: 'inactivity',
    waitStartMs: 4000,
  }, // FP
  {
    id: 'cu-05',
    tool: 'cursor',
    detectorVersion: '1.4.1',
    groundTruth: 'human',
    predicted: null,
    waitStartMs: 5000,
  }, // TN

  // ── terminal, 1.4.0 (older build — expected weaker) ─────────────────────
  {
    id: 'tm-01',
    tool: 'terminal',
    detectorVersion: '1.4.0',
    groundTruth: 'terminal',
    predicted: 'terminal',
    waitStartMs: 1000,
    detectionMs: 3000,
    adEligibleMs: 3000,
    adShownMs: 3200,
  },
  {
    id: 'tm-02',
    tool: 'terminal',
    detectorVersion: '1.4.0',
    groundTruth: 'terminal',
    predicted: null,
    waitStartMs: 2000,
    adEligibleMs: 5000,
  }, // FN (old build misses)
  {
    id: 'tm-03',
    tool: 'terminal',
    detectorVersion: '1.4.0',
    groundTruth: 'ai_generation',
    predicted: null,
    waitStartMs: 3000,
    adEligibleMs: 3600,
  }, // FN
  {
    id: 'tm-04',
    tool: 'terminal',
    detectorVersion: '1.4.0',
    groundTruth: 'human',
    predicted: null,
    waitStartMs: 4000,
  }, // TN
  {
    id: 'tm-05',
    tool: 'terminal',
    detectorVersion: '1.4.0',
    groundTruth: 'human',
    predicted: 'terminal',
    waitStartMs: 5000,
  }, // FP
];
