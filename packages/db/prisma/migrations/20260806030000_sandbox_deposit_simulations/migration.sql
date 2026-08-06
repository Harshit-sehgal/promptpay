-- WL-070: isolated XTS advertiser deposit simulations.
CREATE TABLE "sandbox_deposit_simulations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'XTS',
  "amount_minor" BIGINT NOT NULL,
  "requested_outcome" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider_tx_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_deposit_simulations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_deposit_simulations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sandbox_deposit_simulations_account_id_user_id_environment_id_fkey"
    FOREIGN KEY ("account_id", "user_id", "environment_id")
    REFERENCES "sandbox_credit_accounts"("id", "user_id", "environment_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sandbox_deposit_simulations_currency_check" CHECK ("currency" = 'XTS'),
  CONSTRAINT "sandbox_deposit_simulations_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "sandbox_deposit_simulations_account_id_idempotency_key_key"
  ON "sandbox_deposit_simulations"("account_id", "idempotency_key");
CREATE INDEX "sandbox_deposit_simulations_user_id_created_at_idx"
  ON "sandbox_deposit_simulations"("user_id", "created_at");
CREATE INDEX "sandbox_deposit_simulations_environment_id_status_created_at_idx"
  ON "sandbox_deposit_simulations"("environment_id", "status", "created_at");
