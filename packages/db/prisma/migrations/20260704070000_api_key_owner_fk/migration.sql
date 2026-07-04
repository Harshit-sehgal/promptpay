-- Add FK from api_keys.ownerId → users.id with ON DELETE SET NULL.
-- Previously ownerId was a bare String column with no database-level
-- constraint — an API key could reference a non-existent user and remain
-- valid (isActive=true) even after the user was soft-deleted or banned.
-- This migration makes ownerId nullable, adds the FK, and SET NULLs the
-- column on parent User deletion — so validateApiKey can reject any key
-- whose ownerId went null (immediate: owner deleted/banned, key dead).

-- If the FK was already created by a prior run of this migration, drop it
-- first so we can apply the nullable-column + re-add sequence cleanly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_ownerId_fkey'
  ) THEN
    ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_ownerId_fkey";
  END IF;
END $$;

ALTER TABLE "api_keys"
  ALTER COLUMN "ownerId" DROP NOT NULL;

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;