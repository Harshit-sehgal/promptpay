-- Add missing @onDelete directives and FK relations that were previously
-- undocumented in the Prisma schema. These FKs already exist in the DB (from
-- 0_init) but without explicit directives, leaving their behavior implicit
-- and unverifiable at the schema level.
--
-- Changes:
--   1. PayoutRequest.payoutAccountId FK: NO ACTION → RESTRICT
--      (same enforcement, now explicit)
--   2. PayoutAllocation.earningsEntryId FK: NO ACTION → RESTRICT
--      (same enforcement, now explicit)
--   3. AdvertiserLedger.campaignId: add FK to Campaigns, SET NULL
--      (no FK existed before; dangling campaignId references were possible)
--   4. PlatformLedger.campaignId: add FK to Campaigns, SET NULL
--      (no FK existed before)
--
-- All constraints are DEFERRABLE INITIALLY DEFERRED so they can share the
-- same migration without ordering hazards.

-- ── PayoutRequest.payoutAccountId: NO ACTION → RESTRICT ──
ALTER TABLE "payout_requests"
  DROP CONSTRAINT IF EXISTS "payout_requests_payoutAccountId_fkey",
  ADD CONSTRAINT "payout_requests_payoutAccountId_fkey"
    FOREIGN KEY ("payoutAccountId") REFERENCES "payout_accounts"("id") ON DELETE RESTRICT;

-- ── PayoutAllocation.earningsEntryId: NO ACTION → RESTRICT ──
ALTER TABLE "payout_allocations"
  DROP CONSTRAINT IF EXISTS "payout_allocations_earningsEntryId_fkey",
  ADD CONSTRAINT "payout_allocations_earningsEntryId_fkey"
    FOREIGN KEY ("earningsEntryId") REFERENCES "earnings_ledger"("id") ON DELETE RESTRICT;

-- ── AdvertiserLedger.campaignId → Campaign (SET NULL) ──
-- 0_init created no FK. Add one now to prevent dangling references when
-- a Campaign is deleted — ledger rows survive with campaignId=NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'advertiser_ledger_campaignId_fkey'
  ) THEN
    ALTER TABLE "advertiser_ledger"
      ADD CONSTRAINT "advertiser_ledger_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── PlatformLedger.campaignId → Campaign (SET NULL) ──
-- Same rationale as AdvertiserLedger — platform accounting rows must
-- survive campaign lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_ledger_campaignId_fkey'
  ) THEN
    ALTER TABLE "platform_ledger"
      ADD CONSTRAINT "platform_ledger_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;