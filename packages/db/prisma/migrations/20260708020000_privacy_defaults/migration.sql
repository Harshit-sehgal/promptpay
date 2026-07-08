-- Privacy-by-default: new users must opt in to sponsored ads rather than
-- being enrolled implicitly. Existing rows that were created under the old
-- `true` default are left untouched (they were enrolled under the prior
-- behaviour); only the column default changes so future signups start with
-- ads disabled until the user enables them in settings.

ALTER TABLE "user_settings" ALTER COLUMN "ads_enabled" SET DEFAULT false;
