#!/usr/bin/env bash
# Full browser E2E against a PRODUCTION-MODE API (A-101).
#
# `.e2e/run-e2e.sh` builds the web for production but exports
# `NODE_ENV=development` for the API. So all 114 browser tests exercise a
# development API — the exact split that hid A-097 (100% of logins returning
# HTTP 500 in production) through 1316 unit tests and 114 e2e tests.
#
# This runs the SAME suite against an API configured the way a deployment
# configures it:
#   - NODE_ENV=production + WAITLAYER_ENVIRONMENT_KIND=production
#   - PEMs in the single-line `\n`-escaped form (--env-file/Compose format)
#   - a stamped environment marker, full production config schema
#   - mock Google auth OFF, Swagger closed, MFA step-up active
#
# Most tests create users through the public signup API and log in with
# email/password, deliberately avoiding the dev-only mock-Google button. The
# production-only sensitive-journey contract additionally exercises UI signup,
# password-reauthenticated 2FA enrolment, the real action-step-up BFF retry,
# payout-method add/remove, and self-service account erasure.
#
# Uses isolated ports, its own Redis database index, and the TEST database so
# it never touches dev state.
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT="${E2E_PROD_API_PORT:-4108}"
WEB_PORT="${E2E_PROD_WEB_PORT:-3100}"
DB="${E2E_PROD_DATABASE_URL:-postgresql://waitlayer:waitlayer-test@localhost:5433/waitlayer_test?schema=public}"
REDIS_DB="${E2E_PROD_REDIS_DB:-12}"
# Adopt the existing environment-marker id (see production-boot-smoke.sh): both
# local production harnesses share this scratch DB, and a fixed id made
# whichever ran second fail with "REFUSING TO OVERWRITE" for a harness reason.
DETECTED_ENV_ID="$(DATABASE_URL="$DB" node scripts/read-environment-marker.mjs 2>/dev/null || true)"
ENV_ID="${E2E_PROD_ENVIRONMENT_ID:-${DETECTED_ENV_ID:-local-production-harness}}"
WORK="$(mktemp -d)"

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null || true
  sleep 1
  command -v fuser > /dev/null 2>&1 && fuser -k "$API_PORT/tcp" "$WEB_PORT/tcp" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Hermetic start — a leftover server from an earlier run would be tested
# instead of this build, with the wrong keys (see A-098 harness notes).
command -v fuser > /dev/null 2>&1 && fuser -k "$API_PORT/tcp" "$WEB_PORT/tcp" > /dev/null 2>&1 || true
sleep 1

echo "→ generating ephemeral RS256 keys (escaped deployment form)"
openssl genrsa -out "$WORK/private.pem" 2048 2>/dev/null
openssl rsa -in "$WORK/private.pem" -pubout -out "$WORK/public.pem" 2>/dev/null
PRIV="$(awk '{printf "%s\\n", $0}' "$WORK/private.pem")"
PUB="$(awk '{printf "%s\\n", $0}' "$WORK/public.pem")"
JWT_SECRET_VALUE="$(openssl rand -base64 48 | tr -d '\n')"
case "$PRIV" in
  *'\n'*) : ;;
  *) echo "PEM is not escaped — this run would not reproduce production"; exit 1 ;;
esac

cat > "$WORK/api.env" <<ENVEOF
NODE_ENV=production
WAITLAYER_ENVIRONMENT_KIND=production
WAITLAYER_ENVIRONMENT_ID=${ENV_ID}
DATABASE_URL=${DB}
REDIS_URL=redis://localhost:6379/${REDIS_DB}
API_PORT=${API_PORT}
API_BASE_URL=https://api.waitlayer.test
WEB_BASE_URL=https://www.waitlayer.test
JWT_ISSUER=waitlayer
JWT_AUDIENCE=waitlayer-client
JWT_PRIVATE_KEY=${PRIV}
JWT_PUBLIC_KEY=${PUB}
JWT_SECRET=${JWT_SECRET_VALUE}
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
EMAIL_FROM=noreply@waitlayer.test
RESEND_API_KEY=re_e2e_placeholder_never_sends
OPS_ALERT_EMAIL=ops@waitlayer.test
THROTTLE_AUTH_SHORT_LIMIT=200
THROTTLE_AUTH_LONG_LIMIT=500
THROTTLE_EXTENSION_LIMIT=600
THROTTLE_DEFAULT_LIMIT=1000
ENVEOF

# bash cannot `source` escaped PEMs without mangling them (AGENTS.md), so the
# env is parsed in Node and handed to the child directly.
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
pnpm --filter waitlayer-api build > /dev/null

# The web middleware and client bundle inline JWT_PUBLIC_KEY and NEXT_PUBLIC_*
# at BUILD time (A-083) — runtime env does not reach them. The web must
# therefore be rebuilt against this run's key pair.
echo "→ building web against this run's public key (build-time inlining)"
JWT_PUBLIC_KEY="$PUB" \
JWT_SECRET="$JWT_SECRET_VALUE" \
JWT_ISSUER=waitlayer JWT_AUDIENCE=waitlayer-client \
NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}/api/v1" \
NEXT_PUBLIC_ALLOW_MOCK_AUTH=false \
  pnpm --filter waitlayer-web build > /dev/null

echo "→ cold-start: migrate → stamp marker"
(cd packages/db && DATABASE_URL="$DB" pnpm exec prisma migrate deploy > /dev/null)
DATABASE_URL="$DB" WAITLAYER_ENVIRONMENT_KIND=production WAITLAYER_ENVIRONMENT_ID=${ENV_ID} \
  node scripts/bootstrap-environment-marker.mjs --confirm-stamp || {
  echo "marker mismatch — the test DB is claimed by another environment id."
  echo "Reset it or set E2E_PROD_DATABASE_URL to a dedicated database."; exit 1; }

echo "→ booting API in production mode on :$API_PORT"
node "$WORK/spawn.mjs" "$WORK/api.env" "$PWD" node apps/api/dist/apps/api/src/main.js > "$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$API_PORT/api/v1/health" > /dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS "http://localhost:$API_PORT/api/v1/health" > /dev/null 2>&1; then
  echo "production API did not become healthy:"; tail -40 "$WORK/api.log"; exit 1
fi

echo "→ booting web (production) on :$WEB_PORT"
(cd apps/web && NODE_ENV=production \
  WAITLAYER_REQUIRE_DEPLOY_ENV=1 \
  JWT_SECRET="$JWT_SECRET_VALUE" \
  JWT_PUBLIC_KEY="$PUB" JWT_ISSUER=waitlayer JWT_AUDIENCE=waitlayer-client \
  NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}/api/v1" \
  API_INTERNAL_URL="http://localhost:${API_PORT}/api/v1" \
  BFF_TRUST_PROXY_HOPS=1 \
  pnpm exec next start -p "$WEB_PORT" > "$WORK/web.log" 2>&1) &
WEB_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$WEB_PORT/" > /dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS "http://localhost:$WEB_PORT/" > /dev/null 2>&1; then
  echo "web did not become ready:"; tail -40 "$WORK/web.log"; exit 1
fi

echo "→ running the browser suite against the production stack"
export PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL=0
export E2E_API_URL="http://localhost:${API_PORT}/api/v1"
cd apps/web
set +e
E2E_BASE_URL="http://localhost:${WEB_PORT}" \
  E2E_PRODUCTION_MODE=1 \
  pnpm exec playwright test "$@" --reporter=line
STATUS=$?
set -e
[ "$STATUS" -ne 0 ] && { echo "--- API log (tail) ---"; tail -60 "$WORK/api.log"; }
exit "$STATUS"
