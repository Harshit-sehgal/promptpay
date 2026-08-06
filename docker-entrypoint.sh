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

# 1. Block until Postgres is reachable (reads DATABASE_URL from the environment).
node scripts/wait-for-postgres.mjs

# 2. Apply migrations once. Idempotent + advisory-locked.
#
# Run from packages/db, NOT from /app (A-095). Prisma 7 takes the connection
# URL from `prisma.config.ts` rather than the schema's datasource block, and it
# only discovers that config relative to the working directory. Invoked from
# /app the CLI found no config and failed with "The datasource.url property is
# required in your Prisma config file", so no containerized deploy could ever
# migrate. `NODE_PATH` (set in the Dockerfile) makes the globally-installed
# `prisma/config` module resolvable from here.
#
# Run in a subshell so the working directory change cannot leak into the exec
# below — the app must still start from /app.
(cd packages/db && prisma migrate deploy)

# 3. Hand off to the main process as PID 1.
exec "$@"
