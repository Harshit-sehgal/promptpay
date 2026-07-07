-- Two-factor authentication (TOTP) support + consent & data-retention models.

-- 1. MFA columns on users.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" TEXT;

-- 2. Consent ledger (append-only; withdrawing consent inserts a granted=false row).
CREATE TABLE IF NOT EXISTS "consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "consents_userId_purpose_idx" ON "consents" ("userId", "purpose");
CREATE INDEX IF NOT EXISTS "consents_purpose_version_idx" ON "consents" ("purpose", "version");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'consents_userId_fkey'
          AND conrelid = 'consents'::regclass
    ) THEN
        ALTER TABLE "consents"
            ADD CONSTRAINT "consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Operator-tunable retention windows (in days) per data category.
CREATE TABLE IF NOT EXISTS "data_retention_config" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retainDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_retention_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_retention_config_category_key" ON "data_retention_config" ("category");
