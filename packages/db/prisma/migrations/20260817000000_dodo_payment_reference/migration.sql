-- Add Dodo Payments correlation columns to advertiser_ledger. Dodo webhooks
-- carry `payment_id` (money-in) and `refund_id`/`dispute_id` (money-out
-- reversal) instead of Stripe's PaymentIntent ids. The deposit/refund/dispute
-- handlers need their own correlation columns — mirroring the existing
-- stripePaymentIntentId/stripeDisputeId pair — to locate a deposit by payment
-- id and a hold by dispute id without re-scanning by amount.
ALTER TABLE "advertiser_ledger"
  ADD COLUMN "dodoPaymentId" TEXT,
  ADD COLUMN "dodoDisputeId" TEXT;

CREATE INDEX "advertiser_ledger_dodoPaymentId_idx"
  ON "advertiser_ledger" ("dodoPaymentId");

CREATE INDEX "advertiser_ledger_dodoDisputeId_idx"
  ON "advertiser_ledger" ("dodoDisputeId");
