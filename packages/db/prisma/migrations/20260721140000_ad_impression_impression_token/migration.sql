-- Add the raw impression token column so ad responses can be reconstructed
-- for durable distributed idempotency. Existing rows keep NULL (they cannot be
-- reconstructed); new rows store the UUID token returned to the client.
ALTER TABLE "ad_impressions" ADD COLUMN IF NOT EXISTS "impression_token" TEXT;

-- Unique index on the raw token (used by the client for render/qualify/click).
CREATE UNIQUE INDEX IF NOT EXISTS "ad_impressions_impression_token_idx"
  ON "ad_impressions" ("impression_token");
