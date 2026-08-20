# Backup & Restore Runbook

> **Scope:** Postgres, Redis, uploaded files, and configuration secrets.  
> **Owner:** Platform / SRE.  
> **Review cadence:** Quarterly, or after any major schema/migration change.

## 1. Objectives

This runbook describes how to create, validate, and restore backups for the Ateva platform. Backups protect against operator error, application bugs, data corruption, and infrastructure failures.

## 2. What Must Be Backed Up

| Data store          | What to back up                                                               | Frequency                  | Retention          |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------- | ------------------ |
| PostgreSQL          | Full logical dump (`pg_dump`) and continuous WAL archives                     | Daily full, continuous WAL | 30 days minimum    |
| Redis               | RDB snapshots and/or AOF                                                      | Hourly RDB                 | 7 days minimum     |
| Object/file storage | Campaign creative assets, export files                                        | Continuous replication     | 30 days minimum    |
| Secrets             | `JWT_SECRET`, `TOTP_SECRET_ENCRYPTION_KEY`, provider API keys, DB credentials | On change                  | Indefinite (vault) |
| Configuration       | Environment files, Terraform / k8s manifests                                  | On change                  | Version-controlled |

## 3. PostgreSQL Backups

### 3.1 Automated daily logical dump

```bash
# Run from a host with pg_dump and network access to Postgres.
export PGHOST="${POSTGRES_HOST}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGUSER="${POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD}"
export PGDATABASE="${POSTGRES_DB}"

BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$BACKUP_DIR"' EXIT

# The repository script sets umask 077, uses pipefail, and emits a manifest.
scripts/backup-db.sh "$BACKUP_DIR"
aws s3 cp "$BACKUP_DIR/$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump.gz' -printf '%f\n' | head -1)" \
  s3://ateva-backups/postgres/
```

### 3.2 Continuous WAL archiving (point-in-time recovery)

Ensure `postgresql.conf` contains:

```text
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://ateva-backups/postgres/wal/%f'
```

### 3.3 Restore from logical dump

1. Stop application traffic (scale web/API pods to 0 or enable maintenance mode).
2. Create a fresh database:
   ```bash
   createdb -h "$PGHOST" -U "$PGUSER" ateva_restored
   ```
3. Download and restore the dump (an `s3://` URI is not a shell file path):
   ```bash
   aws s3 cp \
     s3://ateva-backups/postgres/ateva-db-YYYYMMDD-HHMMSS.dump.gz \
     ./ateva-restore.dump.gz
   scripts/restore-db.sh \
     ./ateva-restore.dump.gz \
     "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/ateva_restored" \
     --apply-migrations
   ```
4. Verify every durable Prisma model and the ledger invariant against a
   quiesced source (or a source snapshot taken at the same backup boundary):
   ```bash
   SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" \
   RESTORED_DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/ateva_restored" \
     node scripts/verify-backup.mjs
   ```
5. Verify application health checks.
6. Switch the application to the restored database.

## 4. Redis Backups

### 4.1 Manual RDB snapshot

```bash
redis-cli BGSAVE
# Copy the resulting dump.rdb to durable storage.
aws s3 cp /var/lib/redis/dump.rdb s3://ateva-backups/redis/dump-$(date -u +%Y%m%d-%H%M%S).rdb
```

### 4.2 Restore Redis

1. Stop the application or put it in maintenance mode.
2. Stop Redis.
3. Replace `dump.rdb` with the desired backup.
4. Start Redis.
5. Verify keys and TTLs.

## 5. Object Storage Backups

If creative assets or export files are stored in S3 / GCS / R2:

- Enable versioning on the bucket.
- Replicate to a second region or bucket.
- Test restore by downloading a sample object.

## 6. Backup Verification

At least once a month:

1. Restore the latest Postgres dump to a sandbox database.
2. Run `pnpm --filter @ateva/db migrate deploy`.
3. Run `node scripts/verify-backup.mjs` with `SOURCE_DATABASE_URL` and
   `RESTORED_DATABASE_URL`; it compares every durable Prisma model and the
   financial invariant.
4. Verify Redis restore by checking key counts.
5. Verify object storage restore by listing and downloading sample objects.

## 7. Retention & Cleanup

- Delete logical dumps older than retention policy.
- Delete WAL archives older than the oldest full backup.
- Document any exceptions for compliance holds.

## 8. Escalation

If a backup or restore fails:

1. Open a P1 incident.
2. Notify the on-call engineer and engineering lead.
3. Do not delete existing backups until the issue is resolved.
