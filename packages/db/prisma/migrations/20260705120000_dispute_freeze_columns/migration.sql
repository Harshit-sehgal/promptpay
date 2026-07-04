-- Adds a stripeDisputeId column to advertiser_ledger so the dispute
-- lifecycle handler can reliably locate hold/parent rows by dispute id
-- (release-on-won / write-off-on-lost) without re-scanning by amount/PI.
-- Also adds a supporting index for the dispute-close lookup path.
ALTER TABLE "advertiser_ledger"
  ADD COLUMN "stripeDisputeId" TEXT;

CREATE INDEX "advertiser_ledger_stripeDisputeId_idx"
  ON "advertiser_ledger" ("stripeDisputeId");
