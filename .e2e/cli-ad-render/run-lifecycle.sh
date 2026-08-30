#!/usr/bin/env bash
# Full wait lifecycle against the stub API: marker appears -> ad requested and
# reported rendered -> marker cleared after >5s -> impression qualified.
# Shows the complete money loop next to everything the terminal actually
# displayed. Same isolation rules as run-once.sh.
#
# Usage:  pnpm --filter ateva-cli build && .e2e/cli-ad-render/run-lifecycle.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
T="$(mktemp -d)"
PORT="${PORT:-4600}"

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
trap 'kill $STUB_PID $WATCH_PID 2>/dev/null; rm -rf "$T"' EXIT
WATCH_PID=""
sleep 1

cat > "$T/home/.config/ateva/credentials.json" <<'JSON'
{
  "email": "stub@example.test",
  "accessToken": "stub-access-token",
  "refreshToken": "stub-refresh-token",
  "userId": "user_stub_1",
  "role": "developer",
  "installationId": "11111111-2222-4333-8444-555555555556"
}
JSON
chmod 600 "$T/home/.config/ateva/credentials.json"

printf '{"startTime": %s, "tool": "claude_code"}\n' "$(( $(date +%s) * 1000 - 2000 ))" \
  > "$T/work/.ateva-wait"

cd "$T/work"
HOME="$T/home" \
ATEVA_API_URL="http://127.0.0.1:$PORT" \
ATEVA_ATTESTATION_PROVIDER="stub-provider" \
ATEVA_ATTESTATION_PROVIDER_URL="http://127.0.0.1:$PORT/attest" \
ATEVA_ALLOW_INSECURE_SECRET_STORE=1 \
NODE_ENV=development \
node "$T/cli/dist/index.js" watch > "$T/watch.out" 2>&1 &
WATCH_PID=$!

# Let the 3s poll loop pick up the marker and serve the ad, keep the wait
# visible past the 5s threshold, then clear the marker to end the wait.
sleep 9
: > "$T/work/.ateva-wait"
sleep 5
kill -INT "$WATCH_PID" 2>/dev/null
sleep 2

echo "=== EVERYTHING THE USER SEES IN THE TERMINAL ==="
cat "$T/watch.out"
echo
echo "=== API calls (money loop) ==="
cut -c1-90 "$STUB_LOG"
