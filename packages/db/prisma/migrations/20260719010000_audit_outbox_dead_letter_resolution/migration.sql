-- Round 41 (companion): resolution tracking for audit outbox dead-letter rows.
-- Dead-letter rows are audit_outbox rows with failed_at set (moved there by
-- AuditService.processOutbox after max retries). Operators can retry (reset
-- failed_at) or resolve (record resolved_at/resolved_by/resolution). The
-- resolution fields let the admin dead-letter list distinguish active vs
-- resolved entries and keep an immutable operator audit of the decision.

ALTER TABLE "audit_outbox"
  ADD COLUMN "resolved_at" TIMESTAMPTZ,
  ADD COLUMN "resolved_by" TEXT,
  ADD COLUMN "resolution" TEXT;
