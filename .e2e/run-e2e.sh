#!/usr/bin/env bash
set -euo pipefail
cd /home/harshit/Documents/Work/Money/promptpay

# Clean up any stale servers from previous runs
fuser -k 3000/tcp 4002/tcp 2>/dev/null || true
sleep 1

# Build API and web so E2E tests run against the latest source
pnpm --filter waitlayer-api build
pnpm --filter waitlayer-web build

# Load keys
export JWT_PRIVATE_KEY="$(cat .e2e/jwt-private.pem)"
export JWT_PUBLIC_KEY="$(cat .e2e/jwt-public.pem)"
export JWT_SECRET="local-e2e-jwt-secret-at-least-32-characters-long"
export DATABASE_URL="postgresql://waitlayer:waitlayer-dev@localhost:5432/waitlayer?schema=public"
export REDIS_URL="redis://localhost:6379"
export NODE_ENV="development"
export API_PORT=4002
export API_BASE_URL="http://localhost:4002"
export WEB_BASE_URL="http://localhost:3000"
export EMAIL_DRIVER="console"
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
cd /home/harshit/Documents/Work/Money/promptpay

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
pnpm --filter waitlayer-web exec playwright test
