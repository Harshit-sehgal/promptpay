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
prisma migrate deploy --schema packages/db/prisma/schema.prisma

# 3. Hand off to the main process as PID 1.
exec "$@"
