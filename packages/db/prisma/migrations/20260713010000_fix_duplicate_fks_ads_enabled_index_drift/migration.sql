-- Corrective migration for three independent schema-vs-DB drifts discovered
-- during a fresh-sweep audit (2026-07-13). All were created by prior
-- migrations and silently broke the DB state. This migration fixes the live
-- DB; none of the fixes are reversible (no down-migration support in Prisma).

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Duplicate FK constraints from 20260705140000_ondelete_explicit_directives
--    (case-folded unquoted constraint names → DROP silently skipped →
--     duplicate ADD with incomplete ON UPDATE behavior)
-- ═══════════════════════════════════════════════════════════════════════

-- Drop the lowercase duplicates created by the broken migration. The originals
-- (camelCase with ON UPDATE CASCADE) remain and are the authoritative ones.
ALTER TABLE "ad_impressions"
  DROP CONSTRAINT IF EXISTS "ad_impressions_campaignid_fkey",
  DROP CONSTRAINT IF EXISTS "ad_impressions_creativeid_fkey";

ALTER TABLE "ad_reports"
  DROP CONSTRAINT IF EXISTS "ad_reports_creativeid_fkey";

ALTER TABLE "blocked_categories"
  DROP CONSTRAINT IF EXISTS "blocked_categories_categoryid_fkey";

-- Reinstate the blocked_categories FK with the correct ON DELETE SET NULL
-- + ON UPDATE CASCADE policy declared in schema.prisma. The original camelCase
-- FK (ON DELETE RESTRICT ON UPDATE CASCADE) overrides the SET NULL intent
-- because both constraints must be satisfied, making `onDelete: SetNull`
-- functionally dead. Drop it and replace it with the correct definition.
ALTER TABLE "blocked_categories"
  DROP CONSTRAINT IF EXISTS "blocked_categories_categoryId_fkey",
  ADD CONSTRAINT "blocked_categories_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Ads-enabled column drift from 20260709020000_add_user_settings_ads_enabled
--    (created orphaned snake_case column `ads_enabled` instead of fixing the
--    real camelCase column `adsEnabled`; Prisma maps to `adsEnabled` and never
--    reads `ads_enabled`; the real column still has DEFAULT true contradicting
--    schema.prisma @default(false))
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "ads_enabled";
ALTER TABLE "user_settings" ALTER COLUMN "adsEnabled" SET DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Webhook events single-column unique index drift
--    (20260704080000's DROP CONSTRAINT IF EXISTS silently skipped a unique
--    INDEX, so the old `webhook_events_eventId_key` single-column unique
--    index still coexists with the composite (provider, eventId) unique
--    constraint, defeating the per-provider idempotency scope)
-- ═══════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "webhook_events_eventId_key";