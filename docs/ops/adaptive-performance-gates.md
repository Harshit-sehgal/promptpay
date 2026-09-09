# Adaptive performance gates

This document defines the repository-safe A-110 foundation for repeated
scenario evidence. It is an evidence format and validation boundary, not a
production performance or launch approval.

## Current repeat evidence

Run a catalogued scenario repeatedly with:

```bash
node scripts/scenario-repeat.mjs <manifest.json> [repetitions]
```

The JSON evidence contains the recorded `durationMs` values and nearest-rank
`p50Ms`, `p95Ms`, and `p99Ms` summaries. The repeat script validates that the
percentiles are finite, non-negative, monotonic, and exactly reproducible from
the recorded durations. A small sample can legitimately produce the maximum
duration for both p95 and p99; this is descriptive evidence, not a threshold
decision.

The evidence remains intentionally limited to the existing scenario-runner
duration. It does not claim to measure provider-hook latency, bridge latency,
reconnect recovery, queue loss, crash-free rate, CPU, memory, disk, network,
or other resource overhead.

## Threshold status

Real hook, bridge, reconnect, queue, reliability, and resource thresholds are
**not frozen**. No numeric threshold is defined here because inventing one from
synthetic runs, a small local sample, or an implementation preference would
not be launch evidence. The p99 field must not be interpreted as a pass/fail
gate until representative measurements exist and the thresholds have been
reviewed and explicitly approved.

Before any A-110 threshold becomes enforceable, the measurement record should
identify the observed client/provider mix, environment, build, sample size,
measurement method, missing-data treatment, and the rationale and approver for
each threshold. Until then, use the repeat evidence for comparison and
regression investigation only; do not use it to assert production readiness.
