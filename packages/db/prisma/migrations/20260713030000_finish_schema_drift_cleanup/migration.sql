BEGIN;

-- Finish aligning the migration-built PostgreSQL schema with schema.prisma.
--
-- The two payout foreign keys were recreated in 20260706010000 without the
-- Prisma-default ON UPDATE CASCADE action. Several @updatedAt columns were
-- added with a database DEFAULT solely to backfill existing rows, but that
-- default was never removed. Prisma owns @updatedAt values on writes, so the
-- lasting database shape must not retain those defaults.

ALTER TABLE "payout_requests"
  DROP CONSTRAINT IF EXISTS "payout_requests_payoutAccountId_fkey",
  ADD CONSTRAINT "payout_requests_payoutAccountId_fkey"
    FOREIGN KEY ("payoutAccountId") REFERENCES "payout_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payout_allocations"
  DROP CONSTRAINT IF EXISTS "payout_allocations_earningsEntryId_fkey",
  ADD CONSTRAINT "payout_allocations_earningsEntryId_fkey"
    FOREIGN KEY ("earningsEntryId") REFERENCES "earnings_ledger"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_reports" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "api_keys" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "country_targeting" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "data_retention_config" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "referral_rewards" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "referrals" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "webhook_events" ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;
