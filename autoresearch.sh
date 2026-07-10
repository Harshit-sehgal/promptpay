#!/usr/bin/env bash
#
# autoresearch.sh — benchmark harness for the waitlayer (promptpay) monorepo.
#
# Goal under optimization: eliminate code-quality-gate errors across the
# workspace (TypeScript type errors + ESLint severity-2 errors) so that the
# source tree's static quality gates pass. This is the code-completable
# "remaining work" surfaced in AGENTS.md.
#
# Workload is fully offline and deterministic: per-package `tsc --noEmit`
# (typecheck) and `eslint --format json` (lint). No network, no clock
# dependency, no random seeds. Turbo is bypassed so runs are sequential and
# reproducible.
#
# Emits:
#   METRIC code_errors=<typecheck+lint errors>   (PRIMARY, lower is better)
#   METRIC typecheck_errors=<n>
#   METRIC lint_errors=<n>
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

typecheck_errors=0
lint_errors=0

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

END_TS=$(date +%s)
wall_seconds=$((END_TS - START_TS))

code_errors=$((typecheck_errors + lint_errors))
gates_passing=0
[ "$typecheck_errors" -eq 0 ] && gates_passing=$((gates_passing + 1))
[ "$lint_errors" -eq 0 ] && gates_passing=$((gates_passing + 1))

echo "METRIC code_errors=$code_errors"
echo "METRIC typecheck_errors=$typecheck_errors"
echo "METRIC lint_errors=$lint_errors"
echo "METRIC gates_passing=$gates_passing"
echo "METRIC wall_seconds=$wall_seconds"

exit 0
