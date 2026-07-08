-- Schema drift fix: the `adsEnabled` field existed in the Prisma `UserSettings`
-- model (default false) but no migration ever created the underlying
-- `ads_enabled` column. The earlier `privacy_defaults` migration tried to set
-- its default and therefore assumed the column existed. This migration adds
-- the column so the database matches the schema. Idempotent so it is safe to
-- re-run on databases where the column already exists.

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "ads_enabled" BOOLEAN NOT NULL DEFAULT false;
