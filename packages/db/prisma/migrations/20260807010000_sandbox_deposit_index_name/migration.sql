-- Postgres truncates identifiers to 63 bytes. The explicit index name in
-- 20260806030000 exceeded the limit, so the created name diverged from the
-- canonical Prisma name and migrate diff reported permanent drift. Rename to
-- the canonical generated name; the columns are unchanged.

BEGIN;

ALTER INDEX "sandbox_deposit_simulations_environment_id_status_created_at_id"
  RENAME TO "sandbox_deposit_simulations_environment_id_status_created_a_idx";

COMMIT;