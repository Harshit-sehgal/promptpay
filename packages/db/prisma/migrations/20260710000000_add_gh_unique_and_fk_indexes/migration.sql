-- A-082: harden data integrity.
-- 1) Make `githubId` unique so a single OAuth identity cannot be linked to
--    more than one account (prevents account-takeover via GitHub login).
--    `githubId` is nullable; Postgres UNIQUE indexes permit multiple NULLs,
--    so existing rows with no GitHub link are unaffected.
-- 2) Add the foreign-key backing indexes the Db review flagged as missing.
--    These back Restrict/Cascade FKs and remove seq-scan deletes/joins on the
--    hot paths (dispute freeze, fraud/review queues, payout lookups).
-- Idempotent (IF NOT EXISTS) so it is safe to re-run.

-- CreateIndex: users.githubId (unique)
CREATE UNIQUE INDEX IF NOT EXISTS "users_githubId_key" ON "users" ("githubId");

-- CreateIndex: ad_clicks.deviceId
CREATE INDEX IF NOT EXISTS "ad_clicks_deviceId_idx" ON "ad_clicks" ("deviceId");

-- CreateIndex: earnings_ledger.impressionId / clickId
CREATE INDEX IF NOT EXISTS "earnings_ledger_impressionId_idx" ON "earnings_ledger" ("impressionId");
CREATE INDEX IF NOT EXISTS "earnings_ledger_clickId_idx" ON "earnings_ledger" ("clickId");

-- CreateIndex: payout_requests.payoutAccountId
CREATE INDEX IF NOT EXISTS "payout_requests_payoutAccountId_idx" ON "payout_requests" ("payoutAccountId");

-- CreateIndex: api_keys.advertiserId
CREATE INDEX IF NOT EXISTS "api_keys_advertiserId_idx" ON "api_keys" ("advertiserId");

-- CreateIndex: ad_reports.creativeId
CREATE INDEX IF NOT EXISTS "ad_reports_creativeId_idx" ON "ad_reports" ("creativeId");

-- CreateIndex: fraud_flags.impressionId / clickId
CREATE INDEX IF NOT EXISTS "fraud_flags_impressionId_idx" ON "fraud_flags" ("impressionId");
CREATE INDEX IF NOT EXISTS "fraud_flags_clickId_idx" ON "fraud_flags" ("clickId");

-- CreateIndex: blocked_categories.categoryId
CREATE INDEX IF NOT EXISTS "blocked_categories_categoryId_idx" ON "blocked_categories" ("categoryId");
