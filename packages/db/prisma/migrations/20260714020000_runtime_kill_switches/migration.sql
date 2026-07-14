-- Create the runtime kill-switch / system settings table.
CREATE TABLE IF NOT EXISTS "system_settings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- Unique index for the natural key (scope, target).
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_scope_target_key" ON "system_settings"("scope", "target");

-- Index for scope lookups.
CREATE INDEX IF NOT EXISTS "system_settings_scope_idx" ON "system_settings"("scope");
