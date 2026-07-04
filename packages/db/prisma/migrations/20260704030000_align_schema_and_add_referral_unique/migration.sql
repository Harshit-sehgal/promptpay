-- This supplemental migration aligns the database schema with packages/db/prisma/schema.prisma.
--
-- The 0_init migration omitted three pieces that the schema/model layer requires:
--   1. Device.eventSecret ("eventSecret" column, nullable) — generated per device at
--      registration and used as the HMAC secret for event payloads. Without the
--      column, any code path that reads/writes device.eventSecret throws at
--      runtime against any DB provisioned via `prisma migrate deploy`.
--   2. Referral @@unique([referredId]) — the schema declares this unique index
--      with a comment noting it closes the "user can only be referred once" race
--      that the service-layer check-then-create is otherwise vulnerable to.
--      Without it, concurrent referrers can create duplicate rows on a fresh DB.
--   3. ReferralReward @@unique([referralId]) — prevents duplicate reward rows
--      for a single referral when markPayoutPaid triggers processReferralRewards
--      concurrently (race that exists in the service layer). One paid referral
--      must produce at most one reward row.

-- Add the missing per-device HMAC secret column (nullable to match the schema).
ALTER TABLE "devices" ADD COLUMN "eventSecret" TEXT;

-- Close the self/double-referral race at the DB level (matches @@unique([referredId])).
CREATE UNIQUE INDEX "referrals_referredId_key" ON "referrals"("referredId");

-- Guarantee one reward per referral (matches schema's @@unique([referralId])).
-- Existing duplicates (if any, from the pre-fix window) would block this index —
-- the integration tests + scrub of dev data make that vanishingly unlikely, but
-- this is a safety belt for arbitrary deployments.
CREATE UNIQUE INDEX "referral_rewards_referralId_key" ON "referral_rewards"("referralId");
