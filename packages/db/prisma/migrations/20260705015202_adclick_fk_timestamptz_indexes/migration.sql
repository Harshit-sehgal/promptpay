-- AddForeignKey
-- ad_clicks.campaignId and creativeId had scalar columns with indexes but
-- NO FK constraints (verified against 0_init migration lines ~850-856 and
-- all subsequent migrations — only userId+deviceId+impressionId FKs were
-- created). Without FKs, a deleted Campaign / AdCreative leaves dangling
-- click-ref references (referential integrity hole). RESTRICT because clicks
-- are billing evidence and must not cascade-delete.
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterColumn
-- clickedAt is the authoritative billing timestamp for click events. It was
-- timestamp without time zone (DateTime), mismatching qualifiedAt (already
-- Timestamptz in migration 20260704050000). TZ drift breaks fraud-window
-- alignment between clicks and impressions.
ALTER TABLE "ad_clicks" ALTER COLUMN "clickedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "clickedAt" AT TIME ZONE 'UTC';

-- CreateIndex
-- creativeId on AdImpression: the AdCreative.impressions 1:N FK back-reference
-- scan (creative-performance dashboard queries) had no index → seq scan.
CREATE INDEX "ad_impressions_creativeId_idx" ON "ad_impressions"("creativeId" ASC);

-- CreateIndex
-- payoutRequestId on PayoutAllocation: listing allocations for a specific
-- payout (payout detail screen, admin review) had no index → seq scan.
CREATE INDEX "payout_allocations_payoutRequestId_idx" ON "payout_allocations"("payoutRequestId" ASC);

-- CreateIndex
-- stripeCustomerId on Advertiser: Stripe customer IDs are globally unique per
-- Stripe account. Without @unique, two advertisers could be wired to the same
-- Stripe customer via a TOCTOU race on the webhook first-time-set path.
CREATE UNIQUE INDEX "advertisers_stripeCustomerId_key" ON "advertisers"("stripeCustomerId" ASC);

-- DropIndex
-- @@index([email]) on User duplicates the @unique([email]) which already
-- serves equality/prefix scans. Redundant index adds write cost with no
-- query benefit.
DROP INDEX IF EXISTS "users_email_idx";

-- DropIndex
-- @@index([keyHash]) on ApiKey duplicates the @unique([keyHash]) already
-- serving equality lookups.
DROP INDEX IF EXISTS "api_keys_keyHash_idx";