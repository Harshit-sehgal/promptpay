#!/usr/bin/env bash
# Postgres logical backup for Ateva.
#
# Produces a gzipped custom-format pg_dump that can be restored with
# scripts/restore-db.sh. Designed to run unattended (cron / CI / operator):
#   - exits non-zero on any failure
#   - never embeds the password on the command line (uses PGPASSWORD env)
#   - timestamps the output file in UTC
#   - emits a manifest line parseable by verify-backup.mjs:
#       ATEVA_BACKUP <path> <bytes> <epoch_ms> <source_db>
#
# Usage:
#   scripts/backup-db.sh [OUTPUT_DIR] [DATABASE_URL]
#
# Env (DATABASE_URL takes precedence; falls back to PG* env):
#   DATABASE_URL        postgresql://user:pass@host:port/db
#   PGPASSWORD          used when DATABASE_URL is unset
#   PGHOST/PGPORT/PGUSER/PGDATABASE  standard libpq vars
#
# Exit codes: 0 success, 1 dump failed, 2 missing deps, 3 bad args
set -euo pipefail
# Backups and verbose dump logs can contain sensitive schema/data metadata.
# New files and directories created by this process must be owner-only even
# when the invoking host has a permissive default umask.
umask 077

OUTPUT_DIR="${1:-./backups}"
DATABASE_URL="${2:-${DATABASE_URL:-}}"

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump not found" >&2; exit 2; }
command -v gzip   >/dev/null 2>&1 || { echo "gzip not found" >&2;   exit 2; }

mkdir -p "$OUTPUT_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
SOURCE_DB="ateva"
if [ -n "$DATABASE_URL" ]; then
  # Derive the db name from the URL for the manifest (best-effort).
  SOURCE_DB="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
  export DATABASE_URL
else
  SOURCE_DB="${PGDATABASE:-ateva}"
fi

OUT="$OUTPUT_DIR/ateva-db-$STAMP.dump.gz"

# pg_dump custom format (-Fc) is the most flexible for restore (parallel,
# selective). --no-owner avoids restore failures when the owning role differs.
# PGPASSWORD is honoured by libpq when DATABASE_URL is unset.
if [ -n "$DATABASE_URL" ]; then
  pg_dump --format=custom --no-owner --verbose "$DATABASE_URL" 2>"$OUT.log" | gzip > "$OUT"
else
  pg_dump --format=custom --no-owner --verbose 2>"$OUT.log" | gzip > "$OUT"
fi

BYTES=$(wc -c < "$OUT")
EPOCH=$(date +%s%3N)
echo "ATEVA_BACKUP $OUT $BYTES $EPOCH $SOURCE_DB"
echo "Backup written: $OUT ($(numfmt --to=iec "$BYTES" 2>/dev/null || echo "$BYTES bytes"))"
