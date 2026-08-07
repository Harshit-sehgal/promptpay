-- Preserve the remote funding leg for multi-leg payout providers. A Stripe
-- Connect bank payout can fail after platform funds have already been
-- transferred to the connected account; without this reference, the platform
-- cannot safely reverse that transfer before releasing local allocations.
ALTER TABLE "payout_transactions"
  ADD COLUMN "provider_funding_tx_id" TEXT;

CREATE INDEX "payout_transactions_provider_funding_tx_id_idx"
  ON "payout_transactions"("provider_funding_tx_id");
