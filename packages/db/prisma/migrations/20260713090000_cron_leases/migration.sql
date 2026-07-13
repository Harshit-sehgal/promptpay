BEGIN;

CREATE TABLE "cron_leases" (
  "key" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cron_leases_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "cron_leases_expiresAt_idx" ON "cron_leases"("expiresAt");

COMMIT;
