-- Add destination_hmac column to payout_accounts for duplicate/fraud matching
-- without storing raw destinations. Also adds a unique index to prevent two
-- accounts registering the same normalized destination.
ALTER TABLE "payout_accounts" ADD COLUMN IF NOT EXISTS "destination_hmac" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "payout_accounts_destination_hmac_key" ON "payout_accounts"("destination_hmac");
