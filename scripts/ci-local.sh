#!/usr/bin/env sh
# Local equivalent of the GitHub Actions CI gate set.
# Closes P0.5 ("verified green CI run on the exact SHA") for local reproduction:
# run the same gates CI runs before pushing. Requires Postgres + Redis (the
# same services CI uses) for `pnpm test`.
#
# Usage:
#   ./scripts/ci-local.sh                      # run all code gates
#   JWT_PUBLIC_KEY=... DOCKER_BUILD=1 ./scripts/ci-local.sh   # also build images
#
# NOTE: the Docker build step needs a reachable npm registry (the Dockerfile's
# `corepack prepare pnpm@11.9.0` hits registry.npmjs.org). In sandboxes without
# registry access this step fails with ETIMEDOUT — that is the known A-075
# environment constraint, not a code defect.
set -eu

cd "$(dirname "$0")/.."

run() {
  echo ""
  echo "==> $*"
  "$@"
}

run pnpm --filter @waitlayer/db run generate
run pnpm typecheck
run pnpm lint
run pnpm test
run pnpm build

if [ "${DOCKER_BUILD:-0}" = "1" ]; then
  if [ -z "${JWT_PUBLIC_KEY:-}" ]; then
    echo "SKIP docker build: JWT_PUBLIC_KEY not set (required build arg). See A-075 / deployment-checklist.md." >&2
  else
    echo ""
    echo "==> docker build (api + web)"
    docker build -t waitlayer-api --target api \
      --build-arg JWT_PUBLIC_KEY="$JWT_PUBLIC_KEY" \
      --build-arg JWT_SECRET="${JWT_SECRET:-}" \
      --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4002/api/v1}" \
      --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}" \
      --build-arg NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS="${NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS:-}" \
      .
    docker build -t waitlayer-web --target web \
      --build-arg JWT_PUBLIC_KEY="$JWT_PUBLIC_KEY" \
      --build-arg JWT_SECRET="${JWT_SECRET:-}" \
      --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:4002/api/v1}" \
      --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}" \
      --build-arg NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS="${NEXT_PUBLIC_WAITLAYER_PAYOUT_PROVIDER_STATUS:-}" \
      .
  fi
fi

echo ""
echo "ALL GATES GREEN"
