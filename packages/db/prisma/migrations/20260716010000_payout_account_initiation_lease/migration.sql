-- Serialize emergency payout-account freezes against outbound provider
-- initiation without holding a database transaction across external I/O.
-- The payout id is a durable fence: a crashed worker leaves an explicit
-- reconciliation requirement instead of an expiring ambiguous money move.
BEGIN;

ALTER TABLE "payout_accounts"
  ADD COLUMN "initiation_payout_id" TEXT;

-- Preserve pre-deploy ambiguous initiations. A pending placeholder means the
-- old process crossed its durable claim boundary but never bound a provider
-- transaction id; it is unsafe to permit another initiation or freeze until
-- an operator reconciles that payout.
DO $$
BEGIN
  IF EXISTS (
    SELECT candidates."payoutAccountId"
    FROM (
      SELECT DISTINCT pr."payoutAccountId", pr."id"
      FROM "payout_requests" pr
      JOIN "payout_transactions" pt ON pt."payoutRequestId" = pr."id"
      WHERE pr."status" = 'processing'
        AND pt."status" = 'processing'
        AND pt."providerTxId" = 'initiate_pending_' || pr."id"
    ) candidates
    GROUP BY candidates."payoutAccountId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple ambiguous payout initiations exist for one payout account; reconcile them before deploying the initiation fence migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "payout_accounts" pa
    JOIN "payout_requests" pr ON pr."payoutAccountId" = pa."id"
    JOIN "payout_transactions" pt ON pt."payoutRequestId" = pr."id"
    WHERE pa."is_frozen" = TRUE
      AND pr."status" = 'processing'
      AND pt."status" = 'processing'
      AND pt."providerTxId" = 'initiate_pending_' || pr."id"
  ) THEN
    RAISE EXCEPTION 'A frozen payout account has an ambiguous payout initiation; reconcile it before deploying the initiation fence migration';
  END IF;
END $$;

WITH candidates AS (
  SELECT DISTINCT pr."payoutAccountId", pr."id" AS "payoutId"
  FROM "payout_requests" pr
  JOIN "payout_transactions" pt ON pt."payoutRequestId" = pr."id"
  WHERE pr."status" = 'processing'
    AND pt."status" = 'processing'
    AND pt."providerTxId" = 'initiate_pending_' || pr."id"
)
UPDATE "payout_accounts" pa
SET "initiation_payout_id" = candidates."payoutId"
FROM candidates
WHERE pa."id" = candidates."payoutAccountId";

CREATE INDEX "payout_accounts_initiation_payout_id_idx"
  ON "payout_accounts"("initiation_payout_id");

ALTER TABLE "payout_accounts"
  ADD CONSTRAINT "chk_payout_accounts_frozen_without_initiation_fence"
    CHECK (NOT "is_frozen" OR "initiation_payout_id" IS NULL) NOT VALID;

ALTER TABLE "payout_accounts"
  VALIDATE CONSTRAINT "chk_payout_accounts_frozen_without_initiation_fence";

COMMIT;
