-- WL-074: align sandbox composite tenant identity and idempotency constraints.
-- This migration is forward-only and preserves existing sandbox rows.

-- Precondition guards: the scoped unique keys below must be installable. A
-- legacy dataset with duplicates would otherwise leave the migration half-
-- applied (old constraints dropped, new ones failing). Verified zero
-- duplicates on the reference environment before shipping; these DO blocks
-- make any future deployment with duplicates fail loudly before any index is
-- dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM (SELECT user_id, environment_id FROM sandbox_credit_accounts GROUP BY 1, 2 HAVING count(*) > 1) d) THEN
    RAISE EXCEPTION 'sandbox_credit_accounts has duplicate (user_id, environment_id) rows'; 
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT account_id, idempotency_key FROM sandbox_credit_entries GROUP BY 1, 2 HAVING count(*) > 1) d) THEN
    RAISE EXCEPTION 'sandbox_credit_entries has duplicate (account_id, idempotency_key) rows'; 
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT account_id, idempotency_key FROM sandbox_payout_simulations GROUP BY 1, 2 HAVING count(*) > 1) d) THEN
    RAISE EXCEPTION 'sandbox_payout_simulations has duplicate (account_id, idempotency_key) rows'; 
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT account_id, idempotency_key FROM sandbox_deposit_simulations GROUP BY 1, 2 HAVING count(*) > 1) d) THEN
    RAISE EXCEPTION 'sandbox_deposit_simulations has duplicate (account_id, idempotency_key) rows'; 
  END IF;
END
$$;

DROP INDEX IF EXISTS "sandbox_credit_accounts_user_id_key";
DROP INDEX IF EXISTS "sandbox_credit_entries_idempotency_key_key";
DROP INDEX IF EXISTS "sandbox_payout_simulations_idempotency_key_key";
DROP INDEX IF EXISTS "sandbox_deposit_simulations_idempotency_key_key";

ALTER TABLE "sandbox_credit_entries"
  DROP CONSTRAINT IF EXISTS "sandbox_credit_entries_account_id_fkey";
ALTER TABLE "sandbox_credit_entries"
  DROP CONSTRAINT IF EXISTS "sandbox_credit_entries_account_id_environment_id_fkey";
ALTER TABLE "sandbox_payout_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_payout_simulations_account_id_fkey";
ALTER TABLE "sandbox_payout_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_payout_simulations_account_id_user_id_environment_id_fkey";
ALTER TABLE "sandbox_payout_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_payout_account_fkey";
ALTER TABLE "sandbox_deposit_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_deposit_simulations_account_id_fkey";
ALTER TABLE "sandbox_deposit_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_deposit_simulations_account_id_user_id_environment_id_fkey";
ALTER TABLE "sandbox_deposit_simulations"
  DROP CONSTRAINT IF EXISTS "sandbox_deposit_account_fkey";

CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_credit_accounts_id_user_id_environment_id_key"
  ON "sandbox_credit_accounts"("id", "user_id", "environment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_credit_entries_account_id_idempotency_key_key"
  ON "sandbox_credit_entries"("account_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_payout_simulations_account_id_idempotency_key_key"
  ON "sandbox_payout_simulations"("account_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_deposit_simulations_account_id_idempotency_key_key"
  ON "sandbox_deposit_simulations"("account_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "sandbox_operations_account_id_created_at_idx"
  ON "sandbox_operations"("account_id", "created_at");

ALTER TABLE "sandbox_credit_entries"
  ADD CONSTRAINT "sandbox_credit_entries_account_id_environment_id_fkey"
  FOREIGN KEY ("account_id", "environment_id")
  REFERENCES "sandbox_credit_accounts"("id", "environment_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sandbox_payout_simulations"
  ADD CONSTRAINT "sandbox_payout_simulations_account_id_user_id_environment_id_fkey"
  FOREIGN KEY ("account_id", "user_id", "environment_id")
  REFERENCES "sandbox_credit_accounts"("id", "user_id", "environment_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sandbox_deposit_simulations"
  ADD CONSTRAINT "sandbox_deposit_simulations_account_id_user_id_environment_id_fkey"
  FOREIGN KEY ("account_id", "user_id", "environment_id")
  REFERENCES "sandbox_credit_accounts"("id", "user_id", "environment_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
