#!/usr/bin/env bash
#
# Compose DATABASE_URL and DIRECT_URL from the Supabase database password alone
# and place both on the OCI host.
#
#   scripts/set-supabase-urls.sh
#
# Copy ONLY the database password (Supabase → Connect → Reset database password,
# or your stored one), then run this. Everything else — host, ports, username,
# percent-encoding — is filled in here, because those are exactly the parts that
# get typed wrong once and then fail hours later in a way no log explains.
#
# Why both URLs go through the pooler, measured from the host on 2026-08-22:
#
#   aws-0-ap-northeast-1.pooler.supabase.com  A 35.79.125.133 52.68.3.1 54.64.190.72
#     tcp/6543 OPEN   tcp/5432 OPEN
#   db.<ref>.supabase.co                      no A record  (IPv6 only)
#     the host has one global IPv6 address but no IPv6 route and no egress
#
# So the direct connection is unreachable from this host, whatever the dashboard
# offers. The dashboard's "Transaction pooler uses IPv6 by default" banner is
# about the dedicated IPv4 add-on; the shared pooler resolves to IPv4 perfectly
# well, as the A records above show.
#
#   DATABASE_URL  transaction pooler :6543  + pgbouncer=true  — runtime
#   DIRECT_URL    session pooler     :5432                    — migrations
#
# The transaction pooler cannot run migrations (it is not session-mode), which is
# the whole reason DIRECT_URL exists. The session pooler is session-mode, so it
# can — it is Supabase's documented IPv4 alternative to a direct connection.
#
set -euo pipefail

HOST="${ATEVA_HOST:-ubuntu@100.111.181.4}"
KEY="${ATEVA_SSH_KEY:-$HOME/.ssh/server_key}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-fhczxytpjafqhmvvznqq}"
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-0-ap-northeast-1.pooler.supabase.com}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_clipboard() {
  if command -v wl-paste >/dev/null 2>&1; then wl-paste 2>/dev/null && return 0; fi
  if command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -o 2>/dev/null && return 0; fi
  if command -v xsel >/dev/null 2>&1; then xsel --clipboard --output 2>/dev/null && return 0; fi
  return 1
}

PASSWORD="$(read_clipboard || true)"
PASSWORD="${PASSWORD%$'\n'}"

if [[ -z "$PASSWORD" ]]; then
  echo "clipboard is empty — copy the Supabase database password first" >&2
  exit 1
fi
if [[ "$PASSWORD" == *$'\n'* ]]; then
  echo "refusing: clipboard holds more than one line" >&2
  exit 1
fi
# The commonest mistake is copying the whole connection string instead of the
# password. Catch it and say so, rather than nesting a URL inside a URL.
if [[ "$PASSWORD" == postgres*://* ]]; then
  echo "refusing: that is a whole connection string — copy only the password" >&2
  exit 1
fi
if [[ "$PASSWORD" == *"[YOUR-PASSWORD]"* || "$PASSWORD" == *FILL_ME* ]]; then
  echo "refusing: that is still the placeholder, not the real password" >&2
  exit 1
fi

# Percent-encode. Supabase's own dashboard warns about this, and an unencoded
# '@' or '/' silently truncates the URL into something that parses but points
# somewhere else.
ENCODED="$(PW="$PASSWORD" python3 -c '
import os, urllib.parse
print(urllib.parse.quote(os.environ["PW"], safe=""))
')"

USER_PART="postgres.${PROJECT_REF}"
DATABASE_URL="postgresql://${USER_PART}:${ENCODED}@${POOLER_HOST}:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://${USER_PART}:${ENCODED}@${POOLER_HOST}:5432/postgres"

printf 'password length %s (encoded %s)\n' "${#PASSWORD}" "${#ENCODED}"
printf 'DATABASE_URL -> %s:6543 as %s (pgbouncer=true)\n' "$POOLER_HOST" "$USER_PART"
printf 'DIRECT_URL   -> %s:5432 as %s\n' "$POOLER_HOST" "$USER_PART"

# Reuse the single-secret placer so both values go over stdin, never argv, and
# the shape checks still apply.
place() {
  printf '%s' "$2" | "$here/set-host-secret.sh" "$1" --from-stdin
}

place DATABASE_URL "$DATABASE_URL"
place DIRECT_URL "$DIRECT_URL"

echo
echo "Now verify before starting the service:"
echo "  scripts/verify-host-db.sh"
