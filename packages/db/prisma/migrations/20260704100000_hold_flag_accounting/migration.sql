-- Round 9 follow-up: scope fraud holds to the flag that issued them.
--
-- Problem: `holdEarnings(userId)` bulk-flips every pre-`held` ledger entry
--   for the user to `held`, but doesn't record WHICH flag caused the hold.
--   The matching `releaseEarnings(userId)` (no impressionId) had to bulk-
--   release every `held` entry across all of the user's flags — undoing
--   legitimate holds from a still-open, unrelated concurrent flag. That
--   is a real money-leak: a false-positive review on flag F1 could release
--   money held by a genuine fraud investigation under flag F2.
--
-- Fix: stamp heldByFlagId at hold time, scope the release query to it.

-- 1) Hold-accounting column on earnings_ledger.
--    Nullable because (a) historical holds predate this migration, and
--    (b) released entries clear heldByFlagId at resolution time.
--    ON DELETE SET NULL preserves the ledger row if the originating flag
--    is hard-deleted (audit history remains intact).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'earnings_ledger' AND column_name = 'heldByFlagId'
  ) THEN
    ALTER TABLE "earnings_ledger"
      ADD COLUMN "heldByFlagId" TEXT;
  END IF;
END $$;

-- 2) FK back to fraud_flags (SET NULL on delete preserves ledger history).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'earnings_ledger_heldByFlagId_fkey'
  ) THEN
    ALTER TABLE "earnings_ledger"
      ADD CONSTRAINT "earnings_ledger_heldByFlagId_fkey"
        FOREIGN KEY ("heldByFlagId") REFERENCES "fraud_flags"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Index for the false-positive release query `WHERE "heldByFlagId" = ?`.
CREATE INDEX IF NOT EXISTS "earnings_ledger_heldByFlagId_idx"
  ON "earnings_ledger" ("heldByFlagId");
