#!/bin/sh
# Docker entrypoint for the API runtime image.
#
# Responsibilities (run ONCE per container start, before the app boots):
#   1. Wait for Postgres to accept TCP connections.
#   2. Apply pending database migrations.
#   3. exec the real start command (replacing this shell as PID 1).
#
# Migrations are intentionally NOT part of the image CMD chain: running them
# here, once, before `exec "$@"`, means a process restart/supervision event
# never re-triggers a migrate, and `exec` hands PID 1 to the app so it receives
# signals (SIGTERM) correctly. `prisma migrate deploy` is idempotent (it records
# applied migrations in the database and skips them afterwards) and takes a
# Postgres advisory lock, so replicas that start concurrently serialize safely
# instead of racing or crash-looping.

set -e

# Timestamped phase markers. A container that is slow to become healthy gives
# an operator nothing to go on otherwise: `docker compose ps` says
# "health: starting" and the log is silent until Nest prints its first line.
# Knowing whether the time went to waiting for Postgres, to migrating, or to
# the app itself is the difference between a two-minute diagnosis and a
# guess — and this cold-start path is exactly where a deploy stalls.
phase() {
  echo "[entrypoint $(date -u '+%H:%M:%S')] $*"
}

# 1. Block until Postgres is reachable (reads DATABASE_URL from the environment).
phase "waiting for postgres"
node scripts/wait-for-postgres.mjs

# 2. Apply migrations once. Idempotent + advisory-locked.
#
# Run from packages/db, NOT from /app (A-095). Prisma 7 takes the connection
# URL from `prisma.config.ts` rather than the schema's datasource block, and it
# only discovers that config relative to the working directory. Invoked from
# /app the CLI found no config and failed with "The datasource.url property is
# required in your Prisma config file", so no containerized deploy could ever
# migrate.
#
# Invoke the CLI through packages/db's own bin rather than PATH. prisma is a
# production dependency of packages/db, so it survives `pnpm install --prod`
# and resolves `prisma/config` on the normal module chain — no global install
# and no NODE_PATH. Using the explicit path also means this does not depend on
# a package manager being present in the runtime image.
#
# Run in a subshell so the working directory change cannot leak into the exec
# below — the app must still start from /app.
phase "applying migrations"
(cd packages/db && ./node_modules/.bin/prisma migrate deploy)

# 3. Start-up watchdog (A-115).
#
# Roughly 1 boot in 7 hangs here: migrations finish, this script prints
# "starting application", and then the application emits nothing at all and
# never binds its port. No crash, no restart — the container sits "Up
# (health: starting)" forever. That is the worst possible production failure
# mode, because an orchestrator sees a running container and a deploy simply
# never completes, with an empty log to debug from.
#
# The root cause is still open. This does not fix it; it makes it RECOVERABLE.
# A background subshell survives the `exec` below (it is a separate process),
# waits out a deliberately generous budget, and if the port never opened it
# dumps what the hung process was doing and kills PID 1 so the restart policy
# takes over. A silent hang becomes a crash-and-restart, which orchestrators
# already handle and which leaves evidence behind.
#
# The budget only has to cover application boot: `wait-for-postgres` and
# `migrate deploy` have already completed by this line. A healthy start binds
# in a few seconds, so 120s is ~10x headroom and cannot fire on a slow-but-fine
# boot. Set STARTUP_WATCHDOG_SECONDS=0 to disable.
WATCHDOG_SECONDS="${STARTUP_WATCHDOG_SECONDS:-120}"
WATCHDOG_PORT="${API_PORT:-4002}"

if [ "$WATCHDOG_SECONDS" -gt 0 ] 2>/dev/null; then
  (
    sleep "$WATCHDOG_SECONDS"
    if wget --no-verbose --tries=1 --spider \
      "http://localhost:${WATCHDOG_PORT}/api/v1/health" > /dev/null 2>&1; then
      exit 0
    fi
    echo "[watchdog] application did not bind :${WATCHDOG_PORT} within ${WATCHDOG_SECONDS}s (A-115)"
    echo "[watchdog] ── process table ──"
    ps -o pid,ppid,stat,etime,args -A 2>/dev/null || ps 2>/dev/null || true
    for proc in /proc/[0-9]*; do
      pid="${proc#/proc/}"
      grep -qs "apps/api/dist" "$proc/cmdline" 2>/dev/null || continue
      echo "[watchdog] pid ${pid} state=$(awk '{print $3}' "$proc/stat" 2>/dev/null) blocked_in=$(cat "$proc/wchan" 2>/dev/null || echo n/a)"
    done
    echo "[watchdog] entropy_avail=$(cat /proc/sys/kernel/random/entropy_avail 2>/dev/null || echo n/a)"
    echo "[watchdog] killing PID 1 so the restart policy can recover"
    kill -9 1
  ) &
fi

# 4. Hand off to the main process as PID 1.
phase "starting application"
exec "$@"
