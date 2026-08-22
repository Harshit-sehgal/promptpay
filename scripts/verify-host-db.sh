#!/usr/bin/env bash
#
# Prove the database credentials on the OCI host work, before starting the
# service with them.
#
#   scripts/verify-host-db.sh
#
# This runs the image's own tooling rather than a separate client — the host has
# no psql, no node and no psycopg, and more importantly a check that uses
# different machinery than the real boot can pass while the real boot fails.
# These are the exact two steps `docker-entrypoint.sh` performs before the API
# starts, run in the same image against the same env file:
#
#   1. scripts/wait-for-postgres.mjs   reads DATABASE_URL  — the runtime path
#   2. prisma migrate status           reads DIRECT_URL    — the migration path
#      (packages/db/prisma.config.ts resolves DIRECT_URL || DATABASE_URL)
#
# Step 2 is the one that matters. A transaction-pooler URL pasted into
# DIRECT_URL will connect and answer a trivial query quite happily, and only
# fail when a migration actually runs — the pooler is not session-mode, so it
# cannot hold the advisory lock `migrate deploy` takes out. `migrate status`
# goes down the same path without applying anything.
#
# Nothing is applied and no credential is printed.
#
set -euo pipefail

HOST="${ATEVA_HOST:-ubuntu@100.111.181.4}"
KEY="${ATEVA_SSH_KEY:-$HOME/.ssh/server_key}"
ENV_PATH="${ATEVA_ENV_PATH:-/home/ubuntu/promptpay/.env.production}"
IMAGE="${ATEVA_IMAGE:-ateva-api:main}"

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "$HOST" bash -s -- "$ENV_PATH" "$IMAGE" <<'REMOTE'
set -uo pipefail
ENV_PATH="$1"
IMAGE="$2"

if ! sudo test -r "$ENV_PATH"; then
  echo "env file not readable: $ENV_PATH" >&2
  exit 1
fi

missing="$(sudo grep -c FILL_ME "$ENV_PATH" || true)"
if [ "${missing:-0}" -gt 0 ]; then
  echo "still has ${missing} placeholder(s):"
  sudo grep FILL_ME "$ENV_PATH" | cut -d= -f1 | sed 's/^/  /'
  exit 1
fi

echo "== 1/2  DATABASE_URL — runtime reachability =="
if sudo docker run --rm --env-file "$ENV_PATH" "$IMAGE" \
     node scripts/wait-for-postgres.mjs 2>&1 | tail -5; then
  echo "   OK"
else
  echo "   FAILED — the runtime cannot reach the database"
  exit 1
fi

echo
echo "== 2/2  DIRECT_URL — migration path (session-mode required) =="
out="$(sudo docker run --rm --env-file "$ENV_PATH" --entrypoint sh "$IMAGE" -c \
        'cd packages/db && ./node_modules/.bin/prisma migrate status' 2>&1)"
status=$?
echo "$out" | tail -12
if [ $status -ne 0 ] && ! echo "$out" | grep -qi "have not yet been applied\|Database schema is up to date"; then
  echo "   FAILED — see above"
  exit 1
fi
echo "   OK"

echo
echo "Both paths verified. Start with:  sudo systemctl start ateva-api"
REMOTE
