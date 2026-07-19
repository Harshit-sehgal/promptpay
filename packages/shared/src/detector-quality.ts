/**
 * Detector-quality measurement (P1.16).
 *
 * The detector emits "wait" signals (ai_generation, inactivity, editor_switch,
 * terminal, task) that the server may monetize. To know whether the detector
 * is actually good we need labelled ground truth: for a corpus of real waits
 * we record what the user was *actually* doing (groundTruth) and what the
 * detector *predicted*. From that we compute the standard information-retrieval
 * quality metrics — precision, recall, false-negative rate, detection latency
 * and ad-too-late rate — overall and broken down by tool and detector version.
 *
 * This module is the computation core of the labelled-detector-quality system.
 * The labelled corpus itself is supplied out of band (a curated dataset, or
 * samples exported from the extension's shadow-mode telemetry); see
 * `detector-quality.dataset.ts` for a real, versioned sample set.
 */

/** Ground-truth activity label for a wait window. */
export type DetectorLabel =
  'ai_generation' | 'inactivity' | 'editor_switch' | 'terminal' | 'task' | 'human';

/** A signal the detector can emit. `human` is never emitted (it is the
 *  ground-truth-only "do not monetize" class). */
export type DetectorSignal = 'ai_generation' | 'inactivity' | 'editor_switch' | 'terminal' | 'task';

/**
 * One labelled wait sample.
 *
 * All timestamps are monotonic milliseconds (e.g. `performance.now()` or an
 * ingestion clock). `detectionMs`/`adShownMs` are omitted when the event did
 * not occur.
 */
export interface LabelledSample {
  id: string;
  /** Tool/UI the wait occurred in, e.g. `vscode`, `claude-code`, `cursor`, `terminal`. */
  tool: string;
  /** Detector build that produced `predicted`, e.g. `1.4.2`. */
  detectorVersion: string;
  /** What the user was actually doing during the wait (ground truth). */
  groundTruth: DetectorLabel;
  /** What the detector emitted, or `null` if it emitted nothing. */
  predicted: DetectorSignal | null;
  /** When the monetizable wait/attention gap began (ground truth). */
  waitStartMs: number;
  /** When the detector emitted `predicted`. Omit if `predicted === null`. */
  detectionMs?: number;
  /** When an ad became eligible to show (ground-truth opportunity). Omit if N/A. */
  adEligibleMs?: number;
  /** When the ad was actually shown. Omit if it was never shown. */
  adShownMs?: number;
}

/** Classes that represent a monetizable wait (a positive for detection). */
const MONETIZABLE: ReadonlySet<DetectorLabel> = new Set<DetectorLabel>([
  'ai_generation',
  'inactivity',
  'editor_switch',
  'terminal',
  'task',
]);

export function isMonetizable(label: DetectorLabel): boolean {
  return MONETIZABLE.has(label);
}

export interface GroupReport {
  count: number;
  /** Ground-truth monetizable waits. */
  positives: number;
  /** Ground-truth human (non-monetizable) waits. */
  negatives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** TP / (TP + FP); `null` when no predicted positives. */
  precision: number | null;
  /** TP / positives (detection rate); `null` when no actual positives. */
  recall: number | null;
  /** FN / positives (1 - recall); `null` when no actual positives. */
  falseNegativeRate: number | null;
  /** (TP + TN) / count; `null` when count === 0. */
  accuracy: number | null;
  /** Mean detection latency over TPs (detectionMs - waitStartMs, floored at 0). */
  meanDetectionLatencyMs: number | null;
  /** Median detection latency over TPs. */
  medianDetectionLatencyMs: number | null;
  /** Samples where an ad was eligible to show. */
  adEligibleCount: number;
  /** Eligible samples where the ad was missed or shown after the late threshold. */
  adTooLateCount: number;
  /** adTooLateCount / adEligibleCount; `null` when no eligible samples. */
  adTooLateRate: number | null;
}

export interface QualityReport {
  overall: GroupReport;
  byTool: Record<string, GroupReport>;
  byVersion: Record<string, GroupReport>;
  /** Ad shown later than this after eligibility (or never shown) counts as too late. */
  lateThresholdMs: number;
  /** Total number of labelled samples analysed. */
  sampleCount: number;
}

const DEFAULT_LATE_THRESHOLD_MS = 5000;

function emptyGroup(): GroupReport {
  return {
    count: 0,
    positives: 0,
    negatives: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    precision: null,
    recall: null,
    falseNegativeRate: null,
    accuracy: null,
    meanDetectionLatencyMs: null,
    medianDetectionLatencyMs: null,
    adEligibleCount: 0,
    adTooLateCount: 0,
    adTooLateRate: null,
  };
}

function computeGroup(samples: LabelledSample[], lateThresholdMs: number): GroupReport {
  const g = emptyGroup();
  const latencies: number[] = [];
  for (const s of samples) {
    g.count++;
    const actualPos = isMonetizable(s.groundTruth);
    const predPos = s.predicted !== null;
    if (actualPos) g.positives++;
    else g.negatives++;

    if (actualPos && predPos) g.tp++;
    else if (actualPos && !predPos) g.fn++;
    else if (!actualPos && predPos) g.fp++;
    else g.tn++;

    if (actualPos && predPos && typeof s.detectionMs === 'number') {
      const lat = s.detectionMs - s.waitStartMs;
      latencies.push(lat >= 0 ? lat : 0);
    }

    if (typeof s.adEligibleMs === 'number') {
      g.adEligibleCount++;
      const tooLate =
        s.predicted === null ||
        s.adShownMs === undefined ||
        s.adShownMs - s.adEligibleMs > lateThresholdMs;
      if (tooLate) g.adTooLateCount++;
    }
  }

  g.precision = g.tp + g.fp > 0 ? g.tp / (g.tp + g.fp) : null;
  g.recall = g.positives > 0 ? g.tp / g.positives : null;
  g.falseNegativeRate = g.positives > 0 ? g.fn / g.positives : null;
  g.accuracy = g.count > 0 ? (g.tp + g.tn) / g.count : null;

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    g.meanDetectionLatencyMs = sum / sorted.length;
    const mid = Math.floor(sorted.length / 2);
    g.medianDetectionLatencyMs =
      sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  g.adTooLateRate = g.adEligibleCount > 0 ? g.adTooLateCount / g.adEligibleCount : null;
  return g;
}

export interface ComputeQualityOptions {
  /** Ad-shown-after-eligibility threshold in ms (default 5000). */
  lateThresholdMs?: number;
}

/**
 * Compute the full detector-quality report from a labelled corpus.
 *
 * `overall` aggregates every sample; `byTool` and `byVersion` partition the
 * same samples so accuracy can be compared across tools and detector builds.
 */
export function computeQualityReport(
  samples: LabelledSample[],
  options: ComputeQualityOptions = {},
): QualityReport {
  const lateThresholdMs = options.lateThresholdMs ?? DEFAULT_LATE_THRESHOLD_MS;
  const byTool: Record<string, LabelledSample[]> = {};
  const byVersion: Record<string, LabelledSample[]> = {};
  for (const s of samples) {
    (byTool[s.tool] ??= []).push(s);
    (byVersion[s.detectorVersion] ??= []).push(s);
  }
  const toRecord = (groups: Record<string, LabelledSample[]>) => {
    const out: Record<string, GroupReport> = {};
    for (const [key, group] of Object.entries(groups)) {
      out[key] = computeGroup(group, lateThresholdMs);
    }
    return out;
  };
  return {
    overall: computeGroup(samples, lateThresholdMs),
    byTool: toRecord(byTool),
    byVersion: toRecord(byVersion),
    lateThresholdMs,
    sampleCount: samples.length,
  };
}

/** Convenience: fetch one group's report from a computed QualityReport. */
export function getGroup(
  report: QualityReport,
  dimension: 'tool' | 'version',
  key: string,
): GroupReport | undefined {
  return dimension === 'tool' ? report.byTool[key] : report.byVersion[key];
}
