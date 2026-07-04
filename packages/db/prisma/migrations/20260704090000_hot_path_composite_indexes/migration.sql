-- Round 4 follow-up: hot-path composite indexes + payout idempotency floor.

-- (1) payout_transactions: UNIQUE(provider, providerTxId).
--   Provider webhooks are retried; without an idempotency floor a retried
--   callback with the same (provider, providerTxId) would INSERT a second
--   payout_transactions row, double-counting the provider transfer against
--   the payout. NULLS NOT DISTINCT is irrelevant here (providerTxId is set
--   by the time a row records a real provider tx), but a plain UNIQUE on
--   (provider, providerTxId) is the correct composite — providers maintain
--   independent txId namespaces, so a global txId-only unique would wrongly
--   collide two legitimate transactions from different providers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payout_transactions_provider_providerTxId_key'
  ) THEN
    ALTER TABLE "payout_transactions"
      ADD CONSTRAINT "payout_transactions_provider_providerTxId_key"
        UNIQUE ("provider", "providerTxId");
  END IF;
END $$;

-- Single-column index for txId-only lookups from provider callbacks.
CREATE INDEX IF NOT EXISTS "payout_transactions_providerTxId_idx"
  ON "payout_transactions" ("providerTxId");

-- (2) earnings_ledger: status + createdAt composite.
--   System-wide scans of the fraud/review/hold queues filter
--   `WHERE status IN (...) AND createdAt > ?`. The single-column
--   status index alone forced Postgres to heap-filter by createdAt.
CREATE INDEX IF NOT EXISTS "earnings_ledger_status_createdAt_idx"
  ON "earnings_ledger" ("status", "createdAt");

-- (3) payout_requests: userId + status composite.
--   Dashboard "my payouts filtered by status" queries filter on both
--   columns; the single-column userId / status indexes above forced
--   Postgres to pick one and heap-filter the other.
CREATE INDEX IF NOT EXISTS "payout_requests_userId_status_idx"
  ON "payout_requests" ("userId", "status");

-- (4) audit_logs: actorId + createdAt, and (targetType, targetId) + createdAt.
--   Audit reads are almost always time-bounded
--   (`WHERE actorId = ? AND createdAt > ?`,
--    `WHERE targetType = ? AND targetId = ? AND createdAt > ?`).
--   The leading (actorId) and (targetType, targetId) indexes couldn't
--   serve these without a sort+filter on createdAt.
CREATE INDEX IF NOT EXISTS "audit_logs_actorId_createdAt_idx"
  ON "audit_logs" ("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_targetType_targetId_createdAt_idx"
  ON "audit_logs" ("targetType", "targetId", "createdAt");
