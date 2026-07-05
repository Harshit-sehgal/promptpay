-- Explicit ON DELETE directives on platform FK fields that previously
-- had implicit (default) behavior. The schema is the authoritative source
-- of these decisions; this migration applies them so the production DB
-- matches the schema without a destructive reset.
--
-- The prior schema had NO @onDelete directive on these relations, which
-- produced Postgres DEFAULT NO ACTION (effectively RESTRICT) at the DB
-- level — functionally identical to RESTRICT, but with NO rationale in
-- the schema, leaving the silent/blocking delete behavior undocumented.
-- Going from NО ACTION to RESTRICT is a no-op (same enforcement); the
-- change here is purely to make the intent explicit so admins can read
-- the schema and understand the policy.
--
-- A separate change on `blocked_categories` moves from NO ACTION to
-- SET NUL because the user-generated blocked-entry rows need to survive
-- a category delete to preserve the historical "what was blocked when"
-- audit row; SET NULL allows the Category FK to vanish while the row
-- itself remains, and the API layer filters out null-category rows
-- for display.

-- ── ad_impressions: campaign + creative → RESTRICT ──
ALTER TABLE "ad_impressions"
  DROP CONSTRAINT IF EXISTS ad_impressions_campaignId_fkey,
  ADD CONSTRAINT ad_impressions_campaignId_fkey
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT;

ALTER TABLE "ad_impressions"
  DROP CONSTRAINT IF EXISTS ad_impressions_creativeId_fkey,
  ADD CONSTRAINT ad_impressions_creativeId_fkey
    FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT;

-- ── ad_reports: creative → RESTRICT (preserve user complaints history) ──
ALTER TABLE "ad_reports"
  DROP CONSTRAINT IF EXISTS ad_reports_creativeId_fkey,
  ADD CONSTRAINT ad_reports_creativeId_fkey
    FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT;

-- ── blocked_categories: category → SET NULL (preserve historic audit row) ──
ALTER TABLE "blocked_categories"
  DROP CONSTRAINT IF EXISTS blocked_categories_categoryId_fkey,
  ADD CONSTRAINT blocked_categories_categoryId_fkey
    FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL;
