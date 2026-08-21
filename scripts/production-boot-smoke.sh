#!/usr/bin/env bash
# Local runner for the production-mode boot smoke (A-098).
#
# Boots the compiled API exactly the way a deployment does — NODE_ENV=production,
# PEMs in the single-line `\n`-escaped form that Compose/--env-file require, a
# stamped environment marker, a bootstrapped admin — then asserts a token can
# actually be issued, verified, and accepted.
#
# Every other local gate runs the API in test or development mode with
# multi-line PEMs, which is why A-097 (100% of logins returning HTTP 500 in
# production) passed 1316 unit tests and 114 e2e tests.
#
# Uses the TEST database (:5433) and an isolated port so it never touches dev
# state. Requires Postgres :5433 and Redis :6379.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-4105}"
DB="${SMOKE_DATABASE_URL:-postgresql://ateva:ateva-test@localhost:5433/ateva_test?schema=public}"
# Own Redis database index. Throttle and brute-force counters live in Redis, so
# sharing db 0 with dev/e2e means a preceding suite can exhaust the auth
# throttle and make this smoke report a false failure (observed 2026-08-07:
# running straight after the e2e suite produced three 429s that looked like
# broken routes). An isolated index keeps the counters ours.
REDIS_DB="${SMOKE_REDIS_DB:-9}"
REDIS_URL="${SMOKE_REDIS_URL:-redis://localhost:6379/${REDIS_DB}}"
# Adopt whatever environment id the shared test database is already stamped
# with, rather than insisting on our own. Both local production harnesses
# (`smoke:production` and `e2e:production`) point at the same scratch DB, so a
# fixed id meant whichever ran second hit "REFUSING TO OVERWRITE" and failed for
# a harness reason rather than a real one. Adopting never overwrites, so the
# wrong-database interlock is preserved.
#
# Build the workspace packages FIRST. `read-environment-marker.mjs` requires
# `@ateva/db`, whose package `main` is `./dist/index.js` — produced by
# `tsc`, not by `prisma generate`. On a clean checkout that read failed with
# MODULE_NOT_FOUND, was swallowed by `|| true`, and the harness then silently
# fell back to `local-production-harness` — which collides with the marker
# `e2e:production` leaves behind and aborts with "REFUSING TO OVERWRITE". The
# interlock was right; the detection was blind because the package was unbuilt.
echo "→ building workspace packages"
pnpm --filter "@ateva/db..." build > /dev/null

DETECTED_ENV_ID="$(DATABASE_URL="$DB" node scripts/read-environment-marker.mjs 2>/dev/null || true)"
ENV_ID="${SMOKE_ENVIRONMENT_ID:-${DETECTED_ENV_ID:-local-production-harness}}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-smoke-admin@ateva.test}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-Str0ng!Passw0rd#2026}"
WORK="$(mktemp -d)"
# Kill the whole process group: the API is launched through a Node spawn helper,
# so killing only the helper's PID leaves the real server holding the port and
# the next run would silently test a stale binary.
cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "$API_PID" 2>/dev/null || true
    sleep 1
  fi
  command -v fuser > /dev/null 2>&1 && fuser -k "$PORT/tcp" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "→ generating ephemeral keys in the ESCAPED deployment form"
openssl genrsa -out "$WORK/private.pem" 2048 2>/dev/null
openssl rsa -in "$WORK/private.pem" -pubout -out "$WORK/public.pem" 2>/dev/null
# awk (not sed) so the newline becomes a literal backslash-n, matching how a
# real .env / --env-file carries a PEM.
PRIV="$(awk '{printf "%s\\n", $0}' "$WORK/private.pem")"
PUB="$(awk '{printf "%s\\n", $0}' "$WORK/public.pem")"
case "$PRIV" in
  *'\n'*) : ;;
  *) echo "PEM is not escaped — this smoke would not reproduce A-097"; exit 1 ;;
esac

cat > "$WORK/env" <<ENVEOF
NODE_ENV=production
ATEVA_ENVIRONMENT_KIND=production
ATEVA_ENVIRONMENT_ID=${ENV_ID}
DATABASE_URL=${DB}
REDIS_URL=${REDIS_URL}
API_PORT=${PORT}
API_BASE_URL=https://api.ateva.test
WEB_BASE_URL=https://www.ateva.test
JWT_ISSUER=ateva
JWT_AUDIENCE=ateva-client
JWT_PRIVATE_KEY=${PRIV}
JWT_PUBLIC_KEY=${PUB}
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
TOTP_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 48 | tr -d '\n')
EMAIL_QUEUE_SECRET=$(openssl rand -hex 32)
PAYOUT_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
PAYOUT_HMAC_KEY=$(openssl rand -base64 32 | tr -d '\n')
PRIVACY_HASH_KEY=$(openssl rand -hex 32)
PAYOUT_REQUIRE_2FA=true
PAYOUT_DESTINATION_COOLDOWN_HOURS=24
BFF_TRUST_PROXY_HOPS=1
TRUST_PROXY_HOPS=1
ALLOWED_COUNTRIES=US,GB
ALLOWED_CURRENCIES=USD,GBP
COOKIE_SECURE=true
EMAIL_DRIVER=resend
EMAIL_FROM=noreply@ateva.test
RESEND_API_KEY=re_local_placeholder_never_sends
OPS_ALERT_EMAIL=ops@ateva.test
ENVEOF

# Spawn helper: bash cannot `source` a file containing escaped PEMs without
# mangling them (AGENTS.md, "never source an environ dump"), so parse in Node.
cat > "$WORK/spawn.mjs" <<'SPAWNEOF'
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [, , envFile, cwd, ...cmd] = process.argv;
const env = { ...process.env };
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
spawn(cmd[0], cmd.slice(1), { env, cwd, stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));
SPAWNEOF

echo "→ building API"
pnpm --filter "ateva-api..." build > /dev/null

echo "→ migrating + stamping marker + bootstrapping admin (cold-start order)"
(cd packages/db && DATABASE_URL="$DB" pnpm exec prisma migrate deploy > /dev/null)
DATABASE_URL="$DB" ATEVA_ENVIRONMENT_KIND=production ATEVA_ENVIRONMENT_ID="$ENV_ID" \
  node scripts/bootstrap-environment-marker.mjs --confirm-stamp
DATABASE_URL="$DB" ADMIN_BOOTSTRAP_TOKEN=local-smoke-bootstrap-token \
  node scripts/bootstrap-admin.mjs --token local-smoke-bootstrap-token \
  --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" 2>&1 | head -2 || true

# The money-switch assertion below is a REAL deployment gate, so it must never
# be relaxed — but it must also never fire for a reason that has nothing to do
# with the build. The default target is the SHARED `ateva_test` database,
# and the integration suites deliberately enable `ads.global`,
# `wait.earnings`, `payouts.requests`, `payouts.auto` and `deposits.global` in
# their `beforeAll`. Running this smoke straight after `vitest run src/integration`
# therefore reported "money switch unexpectedly ENABLED" for a perfectly good
# build. Detect that leftover state up front and name it, rather than letting it
# surface as a deployment defect at the end of a five-minute run.
# (Same class as the Redis-index and port-hermeticity harness fixes above.)
LEFTOVER_SWITCHES="$(DATABASE_URL="$DB" node scripts/read-enabled-money-switches.mjs 2>/dev/null || true)"
if [ -n "$LEFTOVER_SWITCHES" ]; then
  echo "HARNESS ERROR: money switches are already enabled in the target database:"
  echo "  $LEFTOVER_SWITCHES"
  echo
  echo "This is leftover state from the integration suites (they enable these in"
  echo "beforeAll), NOT a defect in the build. A production database seeds them"
  echo "disabled. Clear them, or point the smoke at its own database:"
  echo "  SMOKE_DATABASE_URL=postgresql://.../ateva_smoke pnpm smoke:production"
  exit 2
fi

# Free the port BEFORE booting. Each run mints a fresh key pair, so a leftover
# API from an earlier run would answer the health check with the OLD keys and
# the smoke would then verify a token against the NEW public key — reporting a
# "key pair mismatch" that is an artefact of the harness, not the build.
# (Observed 2026-08-07; the assertion was right, the runner was not hermetic.)
if command -v fuser > /dev/null 2>&1; then
  fuser -k "$PORT/tcp" > /dev/null 2>&1 || true
  sleep 1
fi
if curl -fsS "http://localhost:$PORT/api/v1/health" > /dev/null 2>&1; then
  echo "port $PORT is still serving after cleanup — refusing to test a process we did not start"
  exit 1
fi

echo "→ booting API in production mode on :$PORT"
node "$WORK/spawn.mjs" "$WORK/env" "$PWD" node apps/api/dist/apps/api/src/main.js > "$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/v1/health" > /dev/null 2>&1; then break; fi
  sleep 2
done
if ! curl -fsS "http://localhost:$PORT/api/v1/health" > /dev/null 2>&1; then
  echo "API did not become healthy:"; tail -40 "$WORK/api.log"; exit 1
fi

echo "→ running smoke"
API_BASE_URL="http://localhost:$PORT/api/v1" \
SMOKE_ADMIN_EMAIL="$ADMIN_EMAIL" SMOKE_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
JWT_PUBLIC_KEY="$PUB" \
  node scripts/production-boot-smoke.mjs
