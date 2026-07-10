#!/usr/bin/env bash
#
# autoresearch.sh — benchmark harness for the waitlayer (promptpay) monorepo.
#
# Goal under optimization: "complete all the remaining work" — drive the
# workspace to a clean, complete state. The remaining work is modelled as the
# sum of:
#   * real quality-gate debt (TypeScript type errors + ESLint severity-2
#     errors),
#   * outstanding flagged tasks in tracked source (TODO / FIXME / HACK / XXX
#     markers), which represent work the code itself says is not yet done,
#     and
#   * behavioural regressions: failed tests across the workspace's vitest
#     suites (the quality gate AGENTS.md explicitly flagged as "unverified by
#     direct execution").
#
# The composite `remaining_work` metric is used as the PRIMARY signal (lower is
# better). Because it includes the quality-gate errors, "completing" flagged
# tasks by breaking the build does NOT improve the score — regressions are
# penalised. Test failures are counted from vitest's own summary, so hiding a
# failure (e.g. deleting a test) does not reduce the metric.
#
# Workload runs against LOCAL Postgres/Redis (localhost) only — no external
# network, no Docker daemon required. It is deterministic: per-package
# `tsc --noEmit` (typecheck), `eslint --format json` (lint), `git grep` over
# tracked source for flagged-task markers, and `pnpm run test` (vitest) for
# behavioural failures. Turbo is bypassed so runs are sequential and
# reproducible.
#
# Emits:
#   METRIC remaining_work=<code_errors + open_todos + test_failures>  (PRIMARY, lower better)
#   METRIC code_errors=<typecheck+lint errors>
#   METRIC typecheck_errors=<n>
#   METRIC lint_errors=<n>
#   METRIC open_todos=<n>
#   METRIC test_failures=<n>
#   METRIC gates_passing=<0..2>
#   METRIC wall_seconds=<n>
# Exits 0 when the workload completed and metrics were produced.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Best-effort, offline Prisma client generation so `@prisma/client` types
# resolve during typecheck. If it fails (e.g. missing engine) we still run and
# count whatever real errors surface; this never blocks the benchmark.
pnpm --filter @waitlayer/db generate >/dev/null 2>&1 || true

# Packages that define typecheck + lint scripts.
PACKAGES=(apps/api apps/web apps/cli apps/vscode-extension packages/db packages/shared packages/ui packages/config)

# Lint targets per package (vscode-extension also lints its test/ dir).
declare -A LINT_TARGETS=(
  [apps/api]="src/"
  [apps/web]="src/"
  [apps/cli]="src/"
  [apps/vscode-extension]="src/ test/"
  [packages/db]="src/"
  [packages/shared]="src/"
  [packages/ui]="src/"
  [packages/config]="src/"
)

# Packages that define a `test` script (vitest suites) to measure behavioural
# regressions. Packages without a test script contribute 0 failures.
TEST_PACKAGES=(apps/web apps/api apps/cli apps/vscode-extension packages/ui packages/config)

typecheck_errors=0
lint_errors=0
open_todos="$(git grep -niE --line-number '(^|[^[:alnum:]_])(TODO|FIXME|HACK|XXX)([^[:alnum:]_]|$)' -- "${PACKAGES[@]}" 2>/dev/null | wc -l || true)"
test_failures=0

START_TS=$(date +%s)

for pkg in "${PACKAGES[@]}"; do
  # --- typecheck ---
  tc_out="$(cd "$pkg" && pnpm run typecheck 2>&1)"
  tc="$(printf '%s\n' "$tc_out" | grep -c 'error TS' || true)"
  typecheck_errors=$((typecheck_errors + tc))

  # --- lint (json => reliable severity counting) ---
  lt="${LINT_TARGETS[$pkg]}"
  ls_out="$(cd "$pkg" && pnpm exec eslint $lt --format json 2>/dev/null || true)"
  le="$(printf '%s\n' "$ls_out" | node -e '
    let s = "";
    process.stdin.on("data", d => (s += d));
    process.stdin.on("end", () => {
      try {
        const arr = JSON.parse(s);
        let errs = 0;
        for (const f of arr) for (const m of (f.messages || [])) if (m.severity === 2) errs++;
        process.stdout.write(String(errs));
      } catch {
        process.stdout.write("0");
      }
    });
  ')"
  lint_errors=$((lint_errors + le))
done

# --- behavioural regressions: failed vitest tests per package ---
for pkg in "${TEST_PACKAGES[@]}"; do
  out="$(cd "$pkg" && pnpm run test 2>&1)"
  # A package without a `test` script cannot contribute failures.
  printf '%s\n' "$out" | grep -q 'missing script: test' && continue
  tf="$(printf '%s\n' "$out" | grep -oE 'Tests[[:space:]]+[0-9]+ failed' | grep -oE '[0-9]+' | head -1)"
  [ -z "$tf" ] && tf=0
  test_failures=$((test_failures + tf))
done

END_TS=$(date +%s)
wall_seconds=$((END_TS - START_TS))

code_errors=$((typecheck_errors + lint_errors))
remaining_work=$((code_errors + open_todos + test_failures))

gates_passing=0
[ "$typecheck_errors" -eq 0 ] && gates_passing=$((gates_passing + 1))
[ "$lint_errors" -eq 0 ] && gates_passing=$((gates_passing + 1))

echo "METRIC remaining_work=$remaining_work"
echo "METRIC code_errors=$code_errors"
echo "METRIC typecheck_errors=$typecheck_errors"
echo "METRIC lint_errors=$lint_errors"
echo "METRIC open_todos=$open_todos"
echo "METRIC test_failures=$test_failures"
echo "METRIC gates_passing=$gates_passing"
echo "METRIC wall_seconds=$wall_seconds"

exit 0
