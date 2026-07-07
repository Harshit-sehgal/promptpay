# Operational Runbooks — Backup, Restore & Retention

> Companion to `FOUNDATION_STATUS.md`. Covers the production data-safety
> procedures that were previously undocumented: database backups, restore,
> and the data-retention cron introduced with the compliance module.

## 1. Database backups (PostgreSQL)

The ledger, payout, fraud, and recovery-debt tables are the financial source
of truth. **Back them up before every deploy and on a scheduled cadence.**

### Automated (recommended)
Schedule a `pg_dump` from a secondary/cron pod or the host:

```bash
# Daily logical dump, compressed, with a 14-day retention
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" -U "$DB_USER" -d waitlayer \
  -Fc -Z 9 -f "/backups/waitlayer-$(date +%F).dump"
# Prune dumps older than 14 days
find /backups -name 'waitlayer-*.dump' -mtime +14 -delete
```

For point-in-time recovery, run Postgres in WAL archiving / managed
(replica) mode and snapshot the volume (`pgdata`) rather than logical dumps.

### Docker Compose (local/dev)
The compose `postgres` service persists to the `pgdata` volume. Snapshot the
volume, or run `pg_dump` against the running container:

```bash
docker compose exec postgres pg_dump -U waitlayer -Fc waitlayer > waitlayer.dump
```

> Never rely on the `pgdata` volume alone for production — volumes are not
> backups. A corrupted volume with no dump = total loss of the ledger.

## 2. Restore

```bash
# Restore into a fresh database (drops existing objects)
PGPASSWORD="$DB_PASSWORD" pg_restore \
  -h "$DB_HOST" -U "$DB_USER" -d waitlayer \
  --clean --if-exists /backups/waitlayer-YYYY-MM-DD.dump
```

After restore, re-apply any migrations that post-date the dump (migrations
are idempotent via the `_prisma_migrations` ledger, but verify with
`prisma migrate status`). Then reconcile: run `LedgerCronService` maturity and
confirm the `earnings_ledger` confirmed/paid totals match the
`payout_requests` history before re-enabling payouts.

## 3. Data retention cron

`RetentionCronService` (compliance module) enforces operator-tunable retention
windows stored in `data_retention_config` (days). Categories:

| Category        | Default | Purged when older than |
|-----------------|---------|------------------------|
| `webhook_events`| 90d     | `createdAt`            |
| `audit_logs`    | 365d    | `createdAt`            |
| `sessions`      | 30d     | `expiresAt`            |
| `export_cache`  | 7d      | (no server-side table) |

- Seeds defaults on bootstrap (`ensureRetentionDefaults`) and runs every 24h.
- `retainDays = null` means **retain indefinitely** (never purge).
- Adjust via `UPDATE data_retention_config SET "retainDays" = 180 WHERE category = 'audit_logs';` then the next cycle applies it. No restart required.
- Force a run on demand: trigger the admin/ops task that calls
  `ComplianceService.runAllRetention()` (or restart the API to fire the
  startup run).

> Financial ledgers (`earnings_ledger`, `advertiser_ledger`,
> `platform_ledger`) and `payout_requests` are **intentionally excluded** from
> purge — they are the audit trail and legal record. Account erasure
> (`deleteAccount` / admin `users/:id/erase`) anonymizes PII but retains these
> rows under a pseudonymized user id, per the retention/GDPR policy.

## 4. Consent & erasure endpoints

- `POST /api/v1/consent` — record consent (purpose, version, granted).
- `GET /api/v1/consent/:purpose` — fetch latest consent row.
- `GET /api/v1/consent/:purpose/status` — boolean consented check.
- `POST /api/v1/admin/users/:id/erase` — admin-initiated right-to-be-forgotten
  (reuses `deleteAccount`: anonymizes PII, revokes sessions & API keys, logs
  under the admin actor). Super-admin accounts cannot be erased.
