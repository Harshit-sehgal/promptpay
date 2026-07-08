-- Privacy-by-default: new users must opt in to sponsored ads rather than
-- being enrolled implicitly. Existing rows that were created under the old
-- `true` default are left untouched (they were enrolled under the prior
-- behaviour); only the column default changes so future signups start with
-- ads disabled until the user enables them in settings.
--
-- Guarded so it is a no-op on databases where `ads_enabled` does not exist
-- (the column was removed from the Prisma schema), avoiding drift.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'user_settings'
      AND column_name = 'ads_enabled'
  ) THEN
    ALTER TABLE "user_settings" ALTER COLUMN "ads_enabled" SET DEFAULT false;
  END IF;
END $$;
