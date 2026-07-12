-- Convert `referrals.status` from TEXT to a proper Prisma enum
-- (`ReferralStatus`). The column been TEXT since `0_init` even though
-- `schema.prisma` declared it as `ReferralStatus`; this resolves the drift so
-- `prisma migrate dev` no longer generates a corrective migration and the DB
-- constraints match the Prisma client's expected type.
--
-- The existing TEXT values are exactly the enum members ('pending',
-- 'rewarded'), so an in-place `USING` cast is safe. Any stray value would fail
-- the cast — surfaces legacy data loudly rather than silently coercing.

CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded');

ALTER TABLE "referrals"
  ALTER COLUMN "status" TYPE "ReferralStatus"
  USING ("status"::"ReferralStatus");

ALTER TABLE "referrals"
  ALTER COLUMN "status" SET DEFAULT 'pending';
