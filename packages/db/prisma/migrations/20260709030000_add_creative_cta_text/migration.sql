-- Add the CTA text column to ad creatives so the CTA collected on the
-- new-campaign form is actually stored and served (issue A-022). The column is
-- nullable because not every creative needs an explicit CTA. Idempotent so it
-- is safe to re-run on databases where the column already exists.

ALTER TABLE "ad_creatives" ADD COLUMN IF NOT EXISTS "cta_text" TEXT;
