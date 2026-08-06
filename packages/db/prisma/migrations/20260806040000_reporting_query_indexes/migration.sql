-- Add covering reporting indexes for bounded ledger and impression queries.
-- The existing narrower indexes remain intentionally: their leftmost-prefix
-- plans are useful for hot paths that do not need the trailing columns.
CREATE INDEX "earnings_ledger_userId_status_availableAt_createdAt_idx"
  ON "earnings_ledger"("userId", "status", "availableAt", "createdAt");

CREATE INDEX "ad_impressions_campaignId_qualifiedAt_isBillable_idx"
  ON "ad_impressions"("campaignId", "qualifiedAt", "isBillable");
