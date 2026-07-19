-- P1.10: reconciliation attempt history + escalation tracking on payouts.
-- The status-poll worker records every poll attempt (capped JSON log) and
-- escalates a payout that stays `processing` past the escalation window —
-- including the ambiguous-initiation case (no providerTxId) that previously
-- was silently skipped by the poll loop.
-- Idempotent: re-running on a DB that already has these columns is a no-op
-- for the nullable columns; the NOT NULL column uses a DEFAULT so existing
-- rows are backfilled without an exclusive rewrite.

ALTER TABLE "payout_requests"
  ADD COLUMN "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReconciliationAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationLog" JSONB;
