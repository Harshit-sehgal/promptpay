import { describe, expect, it } from 'vitest';

import {
  computeQualityReport,
  getGroup,
  isMonetizable,
  type LabelledSample,
} from './detector-quality';
import { SAMPLE_LABELLED_DATASET } from './detector-quality.dataset';

describe('detector-quality (P1.16)', () => {
  it('classifies monetizable vs human ground truth', () => {
    expect(isMonetizable('ai_generation')).toBe(true);
    expect(isMonetizable('inactivity')).toBe(true);
    expect(isMonetizable('editor_switch')).toBe(true);
    expect(isMonetizable('terminal')).toBe(true);
    expect(isMonetizable('task')).toBe(true);
    expect(isMonetizable('human')).toBe(false);
  });

  it('computes precision/recall/FNR exactly on a tiny controlled set', () => {
    const samples: LabelledSample[] = [
      {
        id: 'a',
        tool: 't',
        detectorVersion: '1',
        groundTruth: 'ai_generation',
        predicted: 'ai_generation',
        waitStartMs: 0,
        detectionMs: 100,
        adEligibleMs: 100,
        adShownMs: 200,
      },
      {
        id: 'b',
        tool: 't',
        detectorVersion: '1',
        groundTruth: 'human',
        predicted: 'ai_generation',
        waitStartMs: 0,
      },
    ];
    const r = computeQualityReport(samples);
    expect(r.overall.tp).toBe(1);
    expect(r.overall.fp).toBe(1);
    expect(r.overall.fn).toBe(0);
    expect(r.overall.tn).toBe(0);
    expect(r.overall.precision).toBeCloseTo(0.5, 6);
    expect(r.overall.recall).toBe(1);
    expect(r.overall.falseNegativeRate).toBe(0);
    expect(r.overall.meanDetectionLatencyMs).toBe(100);
    expect(r.overall.medianDetectionLatencyMs).toBe(100);
    expect(r.overall.adTooLateRate).toBe(0); // emitted + shown within threshold
  });

  it('flags a missed detection (predicted null) as false negative', () => {
    const samples: LabelledSample[] = [
      {
        id: 'a',
        tool: 't',
        detectorVersion: '1',
        groundTruth: 'ai_generation',
        predicted: null,
        waitStartMs: 0,
        adEligibleMs: 100,
      },
    ];
    const r = computeQualityReport(samples);
    expect(r.overall.fn).toBe(1);
    expect(r.overall.recall).toBe(0);
    expect(r.overall.falseNegativeRate).toBe(1);
    // eligible but never shown -> ad-too-late
    expect(r.overall.adTooLateRate).toBe(1);
  });

  it('computes the full report over the labelled sample corpus', () => {
    const r = computeQualityReport(SAMPLE_LABELLED_DATASET);
    expect(r.sampleCount).toBe(22);

    // Overall: tp=10, fp=3, fn=5, tn=4, positives=15
    expect(r.overall.precision).toBeCloseTo(10 / 13, 6);
    expect(r.overall.recall).toBeCloseTo(10 / 15, 6); // 2/3
    expect(r.overall.falseNegativeRate).toBeCloseTo(5 / 15, 6); // 1/3
    expect(r.overall.accuracy).toBeCloseTo(14 / 22, 6);

    // Detection latency over the 10 TPs: mean 700ms, median 450ms.
    expect(r.overall.meanDetectionLatencyMs).toBe(700);
    expect(r.overall.medianDetectionLatencyMs).toBe(450);

    expect(r.overall.adTooLateRate).toBeCloseTo(5 / 15, 6);

    // Breakdown by tool: vscode is strong (recall 0.8), terminal weak (0.8 too-late).
    const vscode = getGroup(r, 'tool', 'vscode')!;
    expect(vscode.recall).toBeCloseTo(0.8, 6);
    expect(vscode.precision).toBeCloseTo(0.8, 6);
    expect(vscode.medianDetectionLatencyMs).toBe(450);

    const terminal = getGroup(r, 'tool', 'terminal')!;
    expect(terminal.recall).toBeCloseTo(1 / 3, 6);
    expect(terminal.adTooLateRate).toBeCloseTo(2 / 3, 6);

    // Breakdown by version: old 1.4.0 terminal build is weakest.
    const v140 = getGroup(r, 'version', '1.4.0')!;
    expect(v140.recall).toBeCloseTo(1 / 3, 6);
    expect(v140.precision).toBeCloseTo(0.5, 6);
    expect(v140.meanDetectionLatencyMs).toBe(2000);
  });

  it('respects a custom late threshold', () => {
    // With a 1000ms threshold, vs-03 (ad shown 4500ms after 4500ms eligible -> diff 4500) is too late.
    const r = computeQualityReport(SAMPLE_LABELLED_DATASET, { lateThresholdMs: 1000 });
    const vscode = getGroup(r, 'tool', 'vscode')!;
    // vscode eligible: vs-01,02,03,04,07. Too-late: vs-03 (diff 4500>1000) + vs-04 (missed) = 2.
    expect(vscode.adTooLateCount).toBe(2);
    expect(vscode.adTooLateRate).toBeCloseTo(2 / 5, 6);
  });

  it('returns null rates for degenerate groups', () => {
    const r = computeQualityReport([]);
    expect(r.overall.precision).toBeNull();
    expect(r.overall.recall).toBeNull();
    expect(r.overall.accuracy).toBeNull();
    expect(r.overall.adTooLateRate).toBeNull();
  });
});
