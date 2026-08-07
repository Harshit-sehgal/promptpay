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

# 3. Hand off to the main process as PID 1.
phase "starting application"
exec "$@"
