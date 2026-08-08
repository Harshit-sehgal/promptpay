#!/bin/sh
# Docker entrypoint for the API runtime image.
#
# Responsibilities (run ONCE per container start, before the app boots):
#   1. Wait for Postgres to accept TCP connections.
#   2. Apply pending database migrations.
#   3. Start the app as a child, supervised by a start-up watchdog (A-115).
#
# Migrations are intentionally NOT part of the image CMD chain: running them
# here, once, before the app starts, means a process restart/supervision event
# never re-triggers a migrate. The app used to be `exec`'d so it became PID 1
# and received signals directly; it is now a child so the watchdog has a PID it
# can signal, and SIGTERM/SIGINT are forwarded explicitly instead. `prisma migrate deploy` is idempotent (it records
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

# 3. Start the application as a child process.
#
# Not `exec`. The watchdog below needs a PID it can actually signal, and PID 1
# of a PID namespace cannot be signalled from inside it — the kernel discards
# signals to PID 1 unless it installed a handler, and SIGKILL can never have
# one. An earlier version of this watchdog ran `kill -9 1`, which silently did
# nothing and left the container hung exactly as before.
#
# The cost is the automatic PID-1 signal semantics `exec` provided, so they are
# reinstated explicitly below: without forwarding, `docker stop` would kill this
# shell and give the app no chance to run its NestJS shutdown hooks (in-flight
# payouts, Redis disconnect, cron lease release).
phase "starting application"
"$@" &
APP_PID=$!

forward() {
  kill -"$1" "$APP_PID" 2>/dev/null
}
trap 'forward TERM' TERM
trap 'forward INT' INT

# 4. Start-up watchdog (A-115).
#
# Roughly 2 cold starts in 5 hang here: migrations finish, this script prints
# "starting application", and the application then emits nothing at all and
# never binds its port. No crash, no restart — the container sits
# "Up (health: starting)" forever. That is the worst production failure mode
# there is: an orchestrator sees a running container, the deploy never
# completes, and the log is empty.
#
# The root cause is still open (A-115). This does not fix it — it makes it
# RECOVERABLE and leaves evidence. Armed AFTER the app is started so it captures
# a real APP_PID; armed before, the subshell forked with the variable still
# empty and signalled nothing.
#
# The budget covers application boot only — wait-for-postgres and migrate deploy
# have both finished by this line — so a healthy start binds in seconds and 120s
# is ~10x headroom. Set STARTUP_WATCHDOG_SECONDS=0 to disable.
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
    echo "[watchdog] app pid ${APP_PID} state=$(awk '{print $3}' "/proc/${APP_PID}/stat" 2>/dev/null) blocked_in=$(cat "/proc/${APP_PID}/wchan" 2>/dev/null || echo n/a)"
    # Per-THREAD state is the useful signal. The process-level wchan only said
    # `futex_do_wait` — the main thread waiting on something — which does not
    # identify what. A stuck libuv worker shows up here and nowhere else.
    echo "[watchdog] ── threads ──"
    for t in "/proc/${APP_PID}/task"/*; do
      [ -d "$t" ] || continue
      echo "[watchdog]   tid ${t##*/} state=$(awk '{print $3}' "$t/stat" 2>/dev/null) blocked_in=$(cat "$t/wchan" 2>/dev/null || echo n/a)"
    done
    echo "[watchdog] entropy_avail=$(cat /proc/sys/kernel/random/entropy_avail 2>/dev/null || echo n/a)"
    echo "[watchdog] terminating the application so the restart policy can recover"
    kill -9 "$APP_PID" 2>/dev/null
  ) &
fi

# 5. Wait for the application, propagating its exit status.
#
# `wait` returns early when a trap fires, so loop until the child is really gone.
while :; do
  wait "$APP_PID"
  status=$?
  # 128+n means `wait` was interrupted by signal n, not that the child exited.
  if [ "$status" -gt 128 ] && kill -0 "$APP_PID" 2>/dev/null; then
    continue
  fi
  exit "$status"
done
