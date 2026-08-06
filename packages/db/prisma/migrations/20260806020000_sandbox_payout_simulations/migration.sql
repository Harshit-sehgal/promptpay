CREATE TABLE "sandbox_payout_simulations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTS',
    "amount_minor" BIGINT NOT NULL,
    "destination_alias" TEXT NOT NULL,
    "requested_outcome" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_tx_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sandbox_payout_simulations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sandbox_payout_simulations"
  ADD CONSTRAINT "sandbox_payout_simulations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sandbox_payout_simulations"
  ADD CONSTRAINT "sandbox_payout_simulations_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "sandbox_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sandbox_payout_simulations"
  ADD CONSTRAINT "sandbox_payout_simulations_currency_check" CHECK ("currency" = 'XTS');
ALTER TABLE "sandbox_payout_simulations"
  ADD CONSTRAINT "sandbox_payout_simulations_amount_check" CHECK ("amount_minor" > 0);
CREATE UNIQUE INDEX "sandbox_payout_simulations_idempotency_key_key"
  ON "sandbox_payout_simulations"("idempotency_key");
CREATE INDEX "sandbox_payout_simulations_user_id_created_at_idx"
  ON "sandbox_payout_simulations"("user_id", "created_at");
CREATE INDEX "sandbox_payout_simulations_environment_id_status_created_at_idx"
  ON "sandbox_payout_simulations"("environment_id", "status", "created_at");
