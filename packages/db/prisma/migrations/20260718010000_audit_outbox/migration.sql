BEGIN;

CREATE TABLE "audit_outbox" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeSnap" JSONB,
  "afterSnap" JSONB,
  "ipHash" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_retry_at" TIMESTAMPTZ NOT NULL,
  "processed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_outbox_next_retry_at_idx" ON "audit_outbox"("next_retry_at");

CREATE INDEX "audit_outbox_created_at_idx" ON "audit_outbox"("created_at");

COMMIT;
