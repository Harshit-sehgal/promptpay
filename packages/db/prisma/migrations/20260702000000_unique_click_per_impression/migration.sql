DROP INDEX IF EXISTS "ad_clicks_impressionId_idx";

CREATE UNIQUE INDEX "ad_clicks_impressionId_key" ON "ad_clicks"("impressionId");
