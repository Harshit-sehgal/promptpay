-- The initial encryption migration indexed every row with a NULL migration
-- timestamp. New payout accounts are already encrypted and intentionally keep
-- that timestamp NULL, so the index became less selective over time. The
-- backfill script identifies legacy rows by plaintext destination instead.

DROP INDEX IF EXISTS "payout_accounts_encryption_pending_idx";

CREATE INDEX "payout_accounts_encryption_pending_idx"
  ON "payout_accounts"("id")
  WHERE "destination" NOT LIKE 'v1:%';
