BEGIN;

ALTER TABLE "audit_outbox"
  ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "failed_at" TIMESTAMPTZ;

CREATE INDEX "audit_outbox_failed_at_idx" ON "audit_outbox"("failed_at");

COMMIT;
