-- Round 30: Close two DB schema findings.
--
-- 1. CampaignApproval.reviewerId had no FK to User — garbage UUIDs inserted
--    silently. Add a proper FK to users(id) ON DELETE SET NULL. The column is
--    made nullable first so any existing rows with invalid reviewerId values
--    (from test runs / manual DB edits) won't block the FK creation; if
--    production data had invalid reviewerIds, they become NULL rather than
--    failing the migration (defensive — the service layer always passes a real
--    admin user, but we can't verify the existing data shape without prod
--    access).
--
-- 2. ReferralReward had both @@unique([referralId]) and @@index([referralId]).
--    A unique constraint in Postgres already creates a B-tree index, so the
--    separate @@index was a redundant duplicate that doubled write cost on every
--    insert with no read benefit. Drop the redundant index.

-- 1a. Make CampaignApproval.reviewerId nullable so existing invalid values can
--     be NULLed out without failing the migration.
ALTER TABLE "campaign_approvals" ALTER COLUMN "reviewerId" DROP NOT NULL;

-- 1b. Null out any existing reviewerId values that don't reference a real user.
--     Idempotent — if every reviewerId is valid, this updates 0 rows.
UPDATE "campaign_approvals"
SET "reviewerId" = NULL
WHERE "reviewerId" IS NOT NULL
  AND "reviewerId" NOT IN (SELECT "id" FROM "users");

-- 1c. Add the FK with ON DELETE SET NULL so deleting an admin who reviewed
--     campaigns preserves the historical approval record (reviewer becomes NULL
--     rather than cascading the delete or refusing it).
ALTER TABLE "campaign_approvals"
  ADD CONSTRAINT "campaign_approvals_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- 2. Drop the redundant ReferralReward index (the @@unique([referralId])
--    constraint already maintains a B-tree on referralId).
DROP INDEX IF EXISTS "referral_rewards_referralId_idx";
