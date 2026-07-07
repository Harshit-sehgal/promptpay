-- Clean up a legacy camelCase MFA column left by early local security-compliance
-- schema iterations. The canonical Prisma field maps to users.two_factor_enabled.
-- Preserve any enabled accounts before dropping the obsolete column.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'twoFactorEnabled'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'two_factor_enabled'
        ) THEN
            EXECUTE 'UPDATE "users" SET "two_factor_enabled" = true WHERE "twoFactorEnabled" = true';
            EXECUTE 'ALTER TABLE "users" DROP COLUMN "twoFactorEnabled"';
        ELSE
            EXECUTE 'ALTER TABLE "users" RENAME COLUMN "twoFactorEnabled" TO "two_factor_enabled"';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'two_factor_enabled'
    ) THEN
        EXECUTE 'UPDATE "users" SET "two_factor_enabled" = false WHERE "two_factor_enabled" IS NULL';
        EXECUTE 'ALTER TABLE "users" ALTER COLUMN "two_factor_enabled" SET DEFAULT false';
        EXECUTE 'ALTER TABLE "users" ALTER COLUMN "two_factor_enabled" SET NOT NULL';
    END IF;
END $$;
