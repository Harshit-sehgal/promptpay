-- A-057: developer category blocking has no persisted settings or client
-- path. Add a `blocked_categories TEXT[]` column on user_settings so the
-- API loads persisted developer preferences during ad selection and merges
-- them with any per-request client-supplied arrays, guaranteeing enforcement
-- even when the client omits them. Default to an empty array.
-- Idempotent — safe to re-run if the column already exists.

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "blocked_categories" TEXT[] NOT NULL DEFAULT '{}';