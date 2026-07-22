-- A shared payout destination is a high-risk fraud signal, not a registration
-- conflict. Retain a lookup index for the detector while allowing both accounts
-- to exist so the fraud workflow can flag and hold them for manual review.
DROP INDEX IF EXISTS "payout_accounts_destination_hmac_key";
CREATE INDEX IF NOT EXISTS "payout_accounts_destination_hmac_idx"
  ON "payout_accounts"("destination_hmac");
