-- Convert `referrals.status` from TEXT to a proper Prisma enum
-- (`ReferralStatus`). The column has been TEXT since `0_init` even though
-- `schema.prisma` declared it as `ReferralStatus`; this resolves the drift so
-- `prisma migrate dev` no longer generates a corrective migration and the DB
-- constraints match the Prisma client's expected type.
--
-- The existing TEXT values are exactly the enum members ('pending',
-- 'rewarded'), so an in-place `USING` cast is safe. Any stray value would fail
-- the cast — surfaces legacy data loudly rather than silently coercing.
--
-- IMPORTANT: the column's DEFAULT from 0_init is 'pending'::text, which
-- PostgreSQL cannot automatically cast to the new enum type (error 42804).
-- We must drop the default BEFORE the type change, then re-apply it as the
-- new enum literal afterward.
--
-- Idempotent: IF NOT EXISTS guards re-application after a failed first
-- attempt (where CREATE TYPE succeeded but ALTER TABLE failed).

-- 1. Create the enum (if not already created from a prior failed attempt)
DO $$ BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Drop the old TEXT default so the type change doesn't choke on it
ALTER TABLE "referrals" ALTER COLUMN "status" DROP DEFAULT;

-- 3. Convert the column type
ALTER TABLE "referrals"
  ALTER COLUMN "status" TYPE "ReferralStatus"
  USING ("status"::"ReferralStatus");

-- 4. Re-apply the default as the enum literal
ALTER TABLE "referrals" ALTER COLUMN "status" SET DEFAULT 'pending';
