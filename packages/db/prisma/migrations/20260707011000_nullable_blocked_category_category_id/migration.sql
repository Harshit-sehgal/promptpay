-- Align blocked_categories.categoryId with its ON DELETE SET NULL FK.
--
-- Migration 20260705140000 intentionally changed the category FK to SET NULL
-- so historical blocked-category rows survive if an admin removes a Category.
-- The column itself remained NOT NULL, so the database would still reject the
-- SET NULL action at delete time. Make the scalar nullable to match the FK and
-- the Prisma relation.
ALTER TABLE "blocked_categories"
  ALTER COLUMN "categoryId" DROP NOT NULL;
