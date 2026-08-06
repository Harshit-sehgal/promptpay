-- WL-070/WL-072: isolated XTS credits. These tables are not financial ledgers
-- and cannot represent a real deposit, withdrawal, or provider transfer.
CREATE TABLE "sandbox_credit_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'XTS',
  "balance_minor" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_credit_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_credit_accounts_currency_check" CHECK ("currency" = 'XTS'),
  CONSTRAINT "sandbox_credit_accounts_balance_check" CHECK ("balance_minor" >= 0)
);
CREATE UNIQUE INDEX "sandbox_credit_accounts_user_id_key"
  ON "sandbox_credit_accounts"("user_id");
CREATE UNIQUE INDEX "sandbox_credit_accounts_user_id_environment_id_key"
  ON "sandbox_credit_accounts"("user_id", "environment_id");
CREATE INDEX "sandbox_credit_accounts_environment_id_created_at_idx"
  ON "sandbox_credit_accounts"("environment_id", "created_at");
ALTER TABLE "sandbox_credit_accounts"
  ADD CONSTRAINT "sandbox_credit_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sandbox_credit_entries" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'XTS',
  "entry_type" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_credit_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_credit_entries_currency_check" CHECK ("currency" = 'XTS'),
  CONSTRAINT "sandbox_credit_entries_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "sandbox_credit_entries_idempotency_key_key"
  ON "sandbox_credit_entries"("idempotency_key");
CREATE INDEX "sandbox_credit_entries_account_id_created_at_idx"
  ON "sandbox_credit_entries"("account_id", "created_at");
CREATE INDEX "sandbox_credit_entries_environment_id_created_at_idx"
  ON "sandbox_credit_entries"("environment_id", "created_at");
ALTER TABLE "sandbox_credit_entries"
  ADD CONSTRAINT "sandbox_credit_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "sandbox_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
