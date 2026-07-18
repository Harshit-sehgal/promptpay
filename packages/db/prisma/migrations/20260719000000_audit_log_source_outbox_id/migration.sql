-- Add a unique source-outbox id to audit_logs so the outbox drain is idempotent:
-- replaying an outbox row (e.g. after a crash before processedAt is written)
-- upserts on sourceOutboxId instead of inserting a duplicate audit record.
ALTER TABLE "audit_logs" ADD COLUMN "source_outbox_id" TEXT;

CREATE UNIQUE INDEX "audit_logs_source_outbox_id_key" ON "audit_logs" ("source_outbox_id");
