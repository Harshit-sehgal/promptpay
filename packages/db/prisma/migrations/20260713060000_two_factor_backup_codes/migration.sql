BEGIN;

ALTER TABLE "users"
  ADD COLUMN "two_factor_backup_code_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMIT;
