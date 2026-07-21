-- Backfill data migration: encrypt existing plaintext payout destinations
-- and compute their destinationHmac values.
--
-- This migration is SAFE to run in production:
-- 1. It only modifies rows where destination_hmac IS NULL (unprocessed).
-- 2. The encryption is performed by the API at runtime (not SQL), so this
--    migration simply marks rows that need encryption. The actual encryption
--    runs in a one-shot script or at next API startup.
-- 3. The destination_hmac column is nullable, so rows remain usable regardless.
--
-- To execute the actual encryption, run `node scripts/encrypt-legacy-payout-destinations.mjs`
-- after deploying the code that supports encrypted destinations.

-- First, add a processing flag column so the backfill script can track progress.
ALTER TABLE "payout_accounts" ADD COLUMN IF NOT EXISTS "encryption_migrated_at" TIMESTAMPTZ;

-- Index unprocessed rows for efficient backfill
CREATE INDEX IF NOT EXISTS "payout_accounts_encryption_pending_idx"
  ON "payout_accounts"("encryption_migrated_at")
  WHERE "encryption_migrated_at" IS NULL;
