-- Alter all monetary columns from INTEGER to BIGINT to match the Prisma schema.
-- This migration is idempotent: running it on a database that already has
-- BIGINT columns is a no-op (Postgres allows ALTER TABLE ... ALTER COLUMN
-- ... TYPE BIGINT even when the column is already BIGINT).

-- Campaign monetary columns
ALTER TABLE "campaigns" ALTER COLUMN "bidAmountMinor" TYPE BIGINT;
ALTER TABLE "campaigns" ALTER COLUMN "budgetTotalMinor" TYPE BIGINT;
ALTER TABLE "campaigns" ALTER COLUMN "budgetSpentMinor" TYPE BIGINT;

-- Ledger monetary columns
ALTER TABLE "earnings_ledger" ALTER COLUMN "amountMinor" TYPE BIGINT;
ALTER TABLE "advertiser_ledger" ALTER COLUMN "amountMinor" TYPE BIGINT;
ALTER TABLE "platform_ledger" ALTER COLUMN "amountMinor" TYPE BIGINT;

-- Payout monetary columns
ALTER TABLE "payout_requests" ALTER COLUMN "requestedAmountMinor" TYPE BIGINT;
ALTER TABLE "payout_requests" ALTER COLUMN "approvedAmountMinor" TYPE BIGINT;
ALTER TABLE "payout_allocations" ALTER COLUMN "amountMinor" TYPE BIGINT;

-- Referral and recovery monetary columns
ALTER TABLE "referral_rewards" ALTER COLUMN "amountMinor" TYPE BIGINT;
ALTER TABLE "recovery_debt_cases" ALTER COLUMN "amountMinor" TYPE BIGINT;
