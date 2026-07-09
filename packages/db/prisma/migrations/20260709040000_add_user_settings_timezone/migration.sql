-- A-058: quiet mode was evaluated in the API server's local timezone, so a
-- developer outside the server's tz could see ads during their own quiet
-- hours (or have ads suppressed at the wrong time). Store an optional IANA
-- timezone string on UserSettings so the quiet-mode check can evaluate the
-- developer's wall-clock time instead of the server's. Nullable because
-- existing rows have no timezone; quiet mode falls back to UTC in that case.
-- Idempotent so it is safe to re-run where the column already exists.

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
