#!/usr/bin/env bash
# Prove what the CLI actually prints when an ad is served during a wait state.
#
# Hermetic: a stub API + stub attestation provider on loopback, a throwaway
# HOME, and an isolated copy of the compiled CLI bundle (isolated so the
# optional `keytar` dependency cannot resolve — otherwise the run would
# overwrite the real developer's OS-keychain tokens and device event secret).
#
# Usage:  pnpm --filter ateva-cli build && .e2e/cli-ad-render/run-once.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
PORT="${PORT:-4599}"
trap 'rm -rf "$T"' EXIT

BUNDLE="$REPO_ROOT/apps/cli/dist/index.js"
if [ ! -f "$BUNDLE" ]; then
  echo "Build the CLI first: pnpm --filter ateva-cli build" >&2
  exit 1
fi
mkdir -p "$T/cli/dist" "$T/home/.config/ateva" "$T/work"
cp "$BUNDLE" "$T/cli/dist/index.js"
cp "$REPO_ROOT/apps/cli/package.json" "$T/cli/package.json"
chmod 700 "$T/home/.config/ateva"

export STUB_LOG="$T/stub-calls.log"
: > "$STUB_LOG"
PORT="$PORT" node "$HERE/stub-api.js" & STUB_PID=$!
trap 'kill $STUB_PID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1

cat > "$T/home/.config/ateva/credentials.json" <<'JSON'
{
  "email": "stub@example.test",
  "accessToken": "stub-access-token",
  "refreshToken": "stub-refresh-token",
  "userId": "user_stub_1",
  "role": "developer",
  "installationId": "11111111-2222-4333-8444-555555555555"
}
JSON
chmod 600 "$T/home/.config/ateva/credentials.json"

# Wait state started 8s ago: past the 1s reporting floor and the 5s
# qualification threshold.
printf '{"startTime": %s, "tool": "claude_code"}\n' "$(( $(date +%s) * 1000 - 8000 ))" \
  > "$T/work/.ateva-wait"

cd "$T/work"
HOME="$T/home" \
ATEVA_API_URL="http://127.0.0.1:$PORT" \
ATEVA_ATTESTATION_PROVIDER="stub-provider" \
ATEVA_ATTESTATION_PROVIDER_URL="http://127.0.0.1:$PORT/attest" \
ATEVA_ALLOW_INSECURE_SECRET_STORE=1 \
NODE_ENV=development \
node "$T/cli/dist/index.js" watch --once

echo
echo "=== API calls the CLI made ==="
cat "$STUB_LOG"
echo
echo "=== Verdict ==="
echo "The stub creative is titled 'ACME Cloud Build' (advertiser acme.example)."
echo "If that text does not appear in the CLI output above, no ad was shown."
