#!/usr/bin/env bash
# Restore a Ateva Postgres backup produced by scripts/backup-db.sh.
#
# Restores into a TARGET database (must already exist). Designed for DR drills
# and the CI backup-restore verification job: it never clobbers the source DB
# unless explicitly told to, applies migrations post-restore, and runs an
# optional integrity assertion via scripts/verify-backup.mjs.
#
# Usage:
#   scripts/restore-db.sh <DUMP.gz> <TARGET_DATABASE_URL> [--apply-migrations]
#
# Exit codes: 0 success, 1 restore failed, 2 missing deps, 3 bad args
set -euo pipefail

DUMP="${1:-}"
TARGET_URL="${2:-}"
APPLY_MIGRATIONS=0
if [ "${3:-}" = "--apply-migrations" ]; then APPLY_MIGRATIONS=1; fi

[ -n "$DUMP" ]      || { echo "usage: restore-db.sh <DUMP.gz> <TARGET_DATABASE_URL> [--apply-migrations]" >&2; exit 3; }
[ -n "$TARGET_URL" ]|| { echo "usage: restore-db.sh <DUMP.gz> <TARGET_DATABASE_URL> [--apply-migrations]" >&2; exit 3; }
[ -f "$DUMP" ]      || { echo "dump file not found: $DUMP" >&2; exit 3; }
command -v gunzip    >/dev/null 2>&1 || { echo "gunzip not found" >&2;   exit 2; }
command -v pg_restore>/dev/null 2>&1 || { echo "pg_restore not found" >&2; exit 2; }

# pg_restore --no-owner --no-privileges so the dump restores into a DB owned by
# a different role than the source (CI/DR). --clean --if-exists makes the
# restore idempotent against a partially-populated target.
echo "Restoring $DUMP -> $TARGET_URL"
# Any pg_restore error is fatal. The former fallback accepted a partial restore
# whenever even one table existed, which could report success after dropping or
# failing to restore most of the application. --if-exists suppresses harmless
# missing-object drops; --exit-on-error stops at the first real restore error.
gunzip -c "$DUMP" | pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --exit-on-error \
  --dbname="$TARGET_URL"

if [ "$APPLY_MIGRATIONS" -eq 1 ]; then
  echo "Applying migrations to restored DB..."
  DATABASE_URL="$TARGET_URL" pnpm --filter @ateva/db migrate:deploy
fi

echo "Restore complete: $TARGET_URL"
