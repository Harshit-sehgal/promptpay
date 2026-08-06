-- WL-073: one tenant/environment-scoped idempotency namespace for sandbox mutations.
-- Older development databases may have the original single-column primary key
-- without the composite identity index from the preceding sandbox migration.
-- Create the referenced uniqueness floor defensively before adding this FK so
-- forward migration recovery remains safe without a destructive reset.
CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_credit_accounts_id_environment_id_key"
  ON "sandbox_credit_accounts"("id", "environment_id");

-- This registry prevents the same key from being silently reused across
-- faucet, deposit, payout, or future sandbox operations.
CREATE TABLE "sandbox_operations" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "operation_type" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "result_balance_minor" BIGINT,
  "result_id" TEXT,
  "result_status" TEXT,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_operations_account_id_environment_id_fkey"
    FOREIGN KEY ("account_id", "environment_id")
    REFERENCES "sandbox_credit_accounts"("id", "environment_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sandbox_operations_account_id_idempotency_key_key"
  ON "sandbox_operations"("account_id", "idempotency_key");
CREATE INDEX "sandbox_operations_environment_id_created_at_idx"
  ON "sandbox_operations"("environment_id", "created_at");
