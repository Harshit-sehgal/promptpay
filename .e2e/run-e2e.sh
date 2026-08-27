#!/usr/bin/env bash
set -euo pipefail
# Derive the checkout root from this script's location. This was previously a
# hardcoded absolute path to one machine's clone, which made the dev runner
# fail on any other checkout layout; scripts/bootstrap-environment-marker.mjs
# and run-e2e-production.sh already derive their roots, and audit-claims.mjs
# now guards both e2e runners against a hardcoded `/home/...` cd returning.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# E2E auth collapses when root .env and apps/api/.env hold different JWT
# keypairs (AGENTS.md 2026-08-02): the BFF issues tokens signed by one key,
# middleware verifies with the other. Fail early instead of 26 timeout flake.
node .e2e/verify-key-alignment.mjs

# Clean up any stale servers from previous runs
fuser -k 3000/tcp 4002/tcp 2>/dev/null || true
sleep 1

# Build API and web so E2E tests run against the latest source
pnpm --filter "ateva-api..." build
pnpm --filter "ateva-web..." build

# Load keys
export JWT_PRIVATE_KEY="$(cat .e2e/jwt-private.pem)"
export JWT_PUBLIC_KEY="$(cat .e2e/jwt-public.pem)"
export JWT_SECRET="local-e2e-jwt-secret-at-least-32-characters-long"
export DATABASE_URL="postgresql://ateva:ateva-dev@localhost:5432/ateva?schema=public"
export REDIS_URL="redis://localhost:6379"
export NODE_ENV="development"
export API_PORT=4002
export API_BASE_URL="http://localhost:4002"
export WEB_BASE_URL="http://localhost:3000"
export EMAIL_DRIVER="console"
# The whole e2e suite shares one IP; the production auth throttle (10/min)
# exhausted across loginAs helpers caused retry flakes. Test-only API: raise.
export THROTTLE_AUTH_SHORT_LIMIT="200"
export THROTTLE_AUTH_LONG_LIMIT="500"
export THROTTLE_EXTENSION_LIMIT="600"
export THROTTLE_DEFAULT_LIMIT="1000"
export NEXT_PUBLIC_API_URL="http://localhost:4002/api/v1"
export NEXT_PUBLIC_ALLOW_MOCK_AUTH="true"

# Use full Chromium binary (headless shell is not installed in this env)
export PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL=0

# Start API
node apps/api/dist/apps/api/src/main.js > .e2e/api.log 2>&1 &
API_PID=$!

# Start web
cd apps/web
NODE_ENV=production NEXT_PUBLIC_API_URL="http://localhost:4002/api/v1" NEXT_PUBLIC_ALLOW_MOCK_AUTH="true" pnpm exec next start -p 3000 > ../../.e2e/web.log 2>&1 &
WEB_PID=$!
cd "$REPO_ROOT"

# Cleanup function
cleanup() {
  echo "Cleaning up servers..."
  kill $API_PID $WEB_PID 2>/dev/null || true
  wait $API_PID $WEB_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for API
for i in {1..60}; do
  if curl -s http://localhost:4002/api/v1/health/ready > /dev/null 2>&1; then
    echo "API ready"
    break
  fi
  sleep 1
done

# Wait for web
for i in {1..60}; do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|307"; then
    echo "Web ready"
    break
  fi
  sleep 1
done

# Run Playwright tests
pnpm --filter ateva-web exec playwright test

# The VS Code extension's ApiClient live smoke is gated on RUN_LIVE_TESTS, which
# was set nowhere — so it had never run, and the extension's only live API path
# was unverified. The API is already up on :4002, so prove it here: the spec
# signs up a developer over HTTP and asserts the balance arrives as a BIGINT,
# which the mocked unit tests cannot show.
RUN_LIVE_TESTS=true ATEVA_API_URL="http://localhost:4002/api/v1" \
  pnpm --filter ateva-vscode exec vitest run test/api-client.live.spec.ts
