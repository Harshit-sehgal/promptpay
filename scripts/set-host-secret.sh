#!/usr/bin/env bash
#
# Place one secret into the OCI host's .env.production without it passing
# through a terminal, a shell history, an argv list, or an agent transcript.
#
#   scripts/set-host-secret.sh DATABASE_URL
#
# Copy the value in the provider's dashboard (its own "copy" button), then run
# this. The value is read from the clipboard, checked against the shape that
# variable must have, and streamed to the host over stdin — never as an argument,
# so it never appears in the host's process list either. Nothing prints the value
# back: you get a length and a masked form, which is enough to confirm the right
# thing landed and not enough to leak it.
#
# Why this exists: an agent cannot sign in to Upstash, Supabase or Resend on your
# behalf, and reading a live credential off a dashboard would copy it into the
# conversation transcript. The clipboard is the one channel that goes from the
# provider straight to the host.
#
# The five the deployment is waiting on:
#   DATABASE_URL   Supabase, pooled  (:6543, ?pgbouncer=true)
#   DIRECT_URL     Supabase, direct  (:5432)  — migrations cannot use the pooler
#   REDIS_URL      Upstash TCP       (rediss://…:6379)
#   RESEND_API_KEY Resend            (re_…)
#   EMAIL_FROM     a verified sender
#
set -euo pipefail

HOST="${ATEVA_HOST:-ubuntu@100.111.181.4}"
KEY="${ATEVA_SSH_KEY:-$HOME/.ssh/server_key}"
ENV_PATH="${ATEVA_ENV_PATH:-/home/ubuntu/promptpay/.env.production}"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: $0 <VARIABLE_NAME>" >&2
  echo "       DATABASE_URL | DIRECT_URL | REDIS_URL | RESEND_API_KEY | EMAIL_FROM" >&2
  exit 2
fi
if [[ ! "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "refusing: '$NAME' is not a plausible environment variable name" >&2
  exit 2
fi

read_clipboard() {
  if command -v wl-paste >/dev/null 2>&1; then wl-paste 2>/dev/null && return 0; fi
  if command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -o 2>/dev/null && return 0; fi
  if command -v xsel >/dev/null 2>&1; then xsel --clipboard --output 2>/dev/null && return 0; fi
  return 1
}

VALUE="$(read_clipboard || true)"
VALUE="${VALUE%$'\n'}"

# Dashboards hand out whole assignments as often as bare values — Upstash shows
# `REDIS_URL="rediss://…"`, Supabase shows the URL alone. Accept either: strip a
# leading `NAME=`, then one matching pair of surrounding quotes. Anything else is
# left untouched so a real value containing `=` survives.
VALUE="${VALUE#"$NAME"=}"
if [[ ${#VALUE} -ge 2 && "$VALUE" == \"*\" ]]; then VALUE="${VALUE:1:${#VALUE}-2}"; fi
if [[ ${#VALUE} -ge 2 && "$VALUE" == \'*\' ]]; then VALUE="${VALUE:1:${#VALUE}-2}"; fi
VALUE="$(printf '%s' "$VALUE" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"

if [[ -z "$VALUE" ]]; then
  echo "clipboard is empty — copy the value in the provider's dashboard first" >&2
  exit 1
fi
if [[ "$VALUE" == *$'\n'* ]]; then
  echo "refusing: clipboard holds more than one line, so it is not a single value" >&2
  exit 1
fi
if [[ "$VALUE" == *FILL_ME* || "$VALUE" == *YOUR-PASSWORD* || "$VALUE" == *"["* ]]; then
  echo "refusing: the value still contains a placeholder — paste the real one" >&2
  exit 1
fi

# Shape checks. These catch the mistakes that otherwise surface as a service
# that boots and then fails on first use: the pooled URL pasted into DIRECT_URL,
# a REST endpoint pasted into REDIS_URL, a dashboard URL instead of a key.
case "$NAME" in
  DATABASE_URL)
    [[ "$VALUE" =~ ^postgres(ql)?:// ]] || { echo "refusing: not a postgres URL" >&2; exit 1; }
    [[ "$VALUE" == *":6543"* ]] || echo "note: expected the POOLED port :6543 for DATABASE_URL" >&2
    [[ "$VALUE" == *"pgbouncer=true"* ]] || echo "note: pooled Supabase URLs normally carry ?pgbouncer=true" >&2
    ;;
  DIRECT_URL)
    [[ "$VALUE" =~ ^postgres(ql)?:// ]] || { echo "refusing: not a postgres URL" >&2; exit 1; }
    [[ "$VALUE" == *":5432"* ]] || echo "note: expected the DIRECT port :5432 for DIRECT_URL" >&2
    [[ "$VALUE" == *"pgbouncer=true"* ]] && { echo "refusing: DIRECT_URL must not go through the pooler — migrations will fail" >&2; exit 1; }
    ;;
  REDIS_URL)
    [[ "$VALUE" =~ ^rediss?:// ]] || { echo "refusing: not a redis:// or rediss:// URL" >&2; exit 1; }
    [[ "$VALUE" =~ ^rediss:// ]] || echo "note: Upstash requires TLS — expected rediss://, not redis://" >&2
    ;;
  RESEND_API_KEY)
    [[ "$VALUE" =~ ^re_[A-Za-z0-9_-]+$ ]] || { echo "refusing: a Resend key looks like re_..." >&2; exit 1; }
    ;;
  EMAIL_FROM)
    [[ "$VALUE" =~ [^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,} ]] || { echo "refusing: no email address found" >&2; exit 1; }
    ;;
esac

# Prefix only — enough to confirm the right kind of value, never enough to be a
# fragment worth having. A trailing group would narrow a brute force.
masked="$(printf '%s' "$VALUE" | cut -c1-3)"
printf 'setting %s on %s (length %s, starts %s…)\n' "$NAME" "$HOST" "${#VALUE}" "$masked"

# The remote program is not secret, so it travels in argv (base64 to survive
# quoting) and stdin is left free for the value alone. An earlier version sent
# the program on stdin as a heredoc, which silently consumed ssh's stdin — the
# value never arrived and the remote saw an empty string.
REMOTE_SCRIPT=$(cat <<'REMOTE'
import os, sys

name = os.environ["VAR_NAME"]
path = os.environ["ENV_PATH"]
value = sys.stdin.read().rstrip("\n")
if not value:
    sys.exit("remote: received an empty value")

with open(path, "r") as fh:
    lines = fh.read().split("\n")

backup = path + ".bak"
if not os.path.exists(backup):
    with open(backup, "w") as fh:
        fh.write("\n".join(lines))
    os.chmod(backup, 0o600)

out, found = [], False
for line in lines:
    if line.startswith(name + "="):
        out.append(f"{name}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{name}={value}")

tmp = path + ".tmp"
with open(tmp, "w") as fh:
    fh.write("\n".join(out))
os.chmod(tmp, 0o600)
os.replace(tmp, path)

remaining = sum(1 for l in out if "FILL_ME" in l)
print(f"remote: {name} set ({'replaced' if found else 'appended'}); {remaining} placeholder(s) left")
REMOTE
)

SCRIPT_B64="$(printf '%s' "$REMOTE_SCRIPT" | base64 -w0)"

printf '%s' "$VALUE" | ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$HOST" \
  "VAR_NAME=$(printf '%q' "$NAME") ENV_PATH=$(printf '%q' "$ENV_PATH") \
   python3 -c \"import base64;exec(base64.b64decode('$SCRIPT_B64'))\""
