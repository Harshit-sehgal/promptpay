BEGIN;

CREATE TABLE "email_queue" (
  "id" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "text" TEXT,
  "content_hash" TEXT NOT NULL,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_queue_content_hash_key" ON "email_queue"("content_hash");

CREATE INDEX "email_queue_next_retry_at_idx" ON "email_queue"("next_retry_at");

CREATE INDEX "email_queue_expires_at_idx" ON "email_queue"("expires_at");

COMMIT;
