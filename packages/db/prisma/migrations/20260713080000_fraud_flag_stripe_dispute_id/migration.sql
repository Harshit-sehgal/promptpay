-- Promote Stripe dispute idempotency out of JSON evidence into a typed,
-- schema-declared nullable unique column. Existing rows are backfilled; a
-- diagnostic preflight stops before index creation when legacy duplicates
-- require operator repair.

BEGIN;

ALTER TABLE "fraud_flags"
  ADD COLUMN "stripeDisputeId" TEXT;

DO $$
DECLARE
  duplicate_summary TEXT;
BEGIN
  SELECT string_agg(format('%s (%s rows)', duplicate_id, duplicate_count), ', ')
    INTO duplicate_summary
  FROM (
    SELECT
      NULLIF(BTRIM("evidence"->>'stripeDisputeId'), '') AS duplicate_id,
      COUNT(*) AS duplicate_count
    FROM "fraud_flags"
    WHERE NULLIF(BTRIM("evidence"->>'stripeDisputeId'), '') IS NOT NULL
    GROUP BY NULLIF(BTRIM("evidence"->>'stripeDisputeId'), '')
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 20
  ) duplicates;

  IF duplicate_summary IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot backfill fraud_flags.stripeDisputeId: duplicate Stripe disputes: %',
      duplicate_summary
      USING HINT = 'Review duplicate fraud flags, retain one canonical row per Stripe dispute, then rerun migrate deploy.';
  END IF;
END $$;

UPDATE "fraud_flags"
SET "stripeDisputeId" = NULLIF(BTRIM("evidence"->>'stripeDisputeId'), '')
WHERE NULLIF(BTRIM("evidence"->>'stripeDisputeId'), '') IS NOT NULL;

CREATE UNIQUE INDEX "fraud_flags_stripeDisputeId_key"
  ON "fraud_flags"("stripeDisputeId");

COMMIT;
