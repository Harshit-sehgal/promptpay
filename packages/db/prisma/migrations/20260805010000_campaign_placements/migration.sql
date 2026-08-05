-- WL-060: placement configuration is additive. Existing campaign bid and
-- production ad-selection paths remain untouched until a later opportunity
-- release consumes this relation.
CREATE TYPE "AdPlacementType" AS ENUM (
  'foreground_wait',
  'completion_return',
  'input_required',
  'background_sponsor',
  'failure_recovery',
  'dashboard_native'
);

CREATE TABLE "campaign_placements" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "placement_type" "AdPlacementType" NOT NULL,
  "bidType" "BidType" NOT NULL,
  "bid_amount_minor" BIGINT NOT NULL,
  "min_attention_score" DOUBLE PRECISION,
  "min_integration_score" DOUBLE PRECISION,
  "frequency_cap_per_hour" INTEGER,
  "frequency_cap_per_day" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_placements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_placements_campaignId_placement_type_key"
  ON "campaign_placements"("campaignId", "placement_type");
CREATE INDEX "campaign_placements_placement_type_is_active_idx"
  ON "campaign_placements"("placement_type", "is_active");

ALTER TABLE "campaign_placements"
  ADD CONSTRAINT "campaign_placements_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdOpportunity remains text until WL-061 owns generation and validation.
-- This keeps the additive schema migration forward-compatible for the
-- provider-neutral domain and avoids rewriting historical telemetry.
