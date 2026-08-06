-- WL-062: sandbox foreground placement claims are replay-safe and remain
-- structurally separate from production ad impressions and ledgers.
ALTER TABLE "ad_opportunities"
  ADD COLUMN "claim_idempotency_key" TEXT,
  ADD COLUMN "claimed_at" TIMESTAMPTZ,
  ADD COLUMN "selected_campaign_id" TEXT,
  ADD COLUMN "selected_creative_id" TEXT,
  ADD COLUMN "sandbox_impression_token" TEXT;

CREATE INDEX "ad_opportunities_claim_idempotency_key_idx"
  ON "ad_opportunities"("claim_idempotency_key");
