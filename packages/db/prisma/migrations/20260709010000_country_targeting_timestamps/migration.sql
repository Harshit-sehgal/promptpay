-- #32: CountryTargeting is a mutable join table (campaign country targeting
-- can be edited), but it previously tracked neither createdAt nor updatedAt.
-- Add both so change tracking is consistent with other business entities.

ALTER TABLE "country_targeting" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "country_targeting" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
