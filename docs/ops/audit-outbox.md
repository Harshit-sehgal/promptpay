# Audit Outbox & Dead-Letter Runbook

Durable, idempotent audit trail for security- and money-critical events
(`AuditService`). This runbook documents the write path, the single scheduler,
idempotent replay, dead-letter operations, and — critically — the **limits of
the outbox under a total database outage** plus the independent emergency sink.

## Architecture

- **`audit_logs`** — the authoritative, append-only audit record. Written
  synchronously by `logStrict` (inside the business transaction; fail-closed).
- **`audit_outbox`** — a durable queue for events that could not be written to
  `audit_logs` synchronously. Drained by a leased cron into `audit_logs`.

Both tables live in the **same Postgres database**. This is intentional (the
outbox must be transactional with the business row) but it has a hard limit —
see [DB-outage limit](#db-outage-limit).

## Write paths

- `logStrict(entry, tx)` — writes directly to `audit_logs` **inside** the caller's
  Prisma transaction. If the write throws, the transaction rolls back (fail-closed).
  Used for mandatory financial/security state transitions.
- `log(entry)` — writes directly to `audit_logs`; on failure, enqueues to
  `audit_outbox` and returns. Never blocks the caller. Used for observability
  events that must not fail the operation.

## Scheduling (single drainer)

`AuditOutboxCron` is the **sole** scheduler. It acquires a DB lease
(`acquireCronLease('audit-outbox-drain')`) so only one replica drains at a time,
then calls `processOutbox` every 30s. `AuditService` no longer runs its own
timer (removed in P1.5) — a second un-leased timer would have drained
independently on every replica.

## Idempotent replay (P1.6)

`processOutbox` upserts each row into `audit_logs` keyed on the unique
`sourceOutboxId` inside **one** `$transaction` (audit insert + `processedAt`
mark). A crash between the two writes cannot create a duplicate audit record:
the next drain re-attempts and the upsert is a no-op on replay.

## Dead-letter (P1.7)

When a row exhausts `maxRetries` (default 10), `processOutbox` sets
`failedAt` — the row is now **dead-letter**. It is NOT deleted; it is triaged
by an operator via admin endpoints (guarded by `admin`/`support`/`super_admin`):

- `GET  /admin/audit-outbox/dead-letter?page=&limit=` — active dead rows
  (`failedAt` set, `resolvedAt` null), newest first.
- `POST /admin/audit-outbox/dead-letter/:id/retry` — clears `failedAt`,
  resets `retryCount`, sets `nextRetryAt=now` so the cron reprocesses it.
- `POST /admin/audit-outbox/dead-letter/:id/resolve` — terminal; sets
  `resolvedAt`/`resolvedBy`/`resolution`. Re-resolving returns 409.

Both `retry` and `resolve` emit an **immutable operator audit entry** via
`logStrict` (action `audit_dead_letter_retry` / `audit_dead_letter_resolved`),
so the operator decision itself is recorded in `audit_logs`.

## DB-outage limit

> The outbox shares the **same Postgres** as `audit_logs`. It does **NOT**
> provide durability against a **total database outage**.

The outbox protects against _transient post-commit_ DB errors (connection
blips, serialization failures, brief replica unavailability): the event is
queued and drained once the DB is reachable again. It does **not** help when
the entire DB is down — at that point neither the direct `audit_logs` write nor
the `audit_outbox` write can succeed, and the in-process event is lost unless
the caller retries after recovery.

Do **not** treat "the outbox exists" as "audit history survives a DB outage."
For true multi-store durability, the independent sink below is the only
off-Postgres record; it is minimal and alert-only, not a full replay source.

## Independent emergency sink (P1.8)

When **both** the direct write and the outbox write fail (the `enqueueOutbox`
catch block), `AuditService.emitEmergencySink` sends a
`audit_outbox_write_failed` message to **Sentry**, which is independent of
Postgres and survives a total DB outage.

- Payload is deliberately minimal — `action`, `targetType`, `targetId`,
  `actorId`, `actorRole`, `error` — and contains **no** `beforeSnap`/`afterSnap`
  (which may hold PII).
- Sentry's shared `beforeSend` scrubber strips any `Authorization`/`Cookie`/
  `X-Api-Key`/token/secret that slips through.
- This is the alert hook for "both writes failed."

## Alerting & operations

1. **Alert** on the Sentry event `audit_outbox_write_failed` (level `error`),
   and on the `AuditService` `ERROR` log `Failed to persist audit outbox row;
audit entry may be lost`. Either means an audit event was not durably
   recorded and needs investigation.
2. **Monitor** dead-letter volume (`AuditService.countDeadLetter()` / the admin
   list). A sustained rise means `processOutbox` is failing to drain (DB
   pressure, bad payloads) — triage via the dead-letter admin endpoints.
3. **Recover** a dead row with `retry` (re-drain) or `resolve` (accept + record
   reason) after confirming the underlying issue. Resolving is terminal.
