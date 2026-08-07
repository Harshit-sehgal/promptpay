-- Distinguish a provider-pending payout account from one an administrator
-- explicitly rejected. Without this durable state, a stale provider webhook
-- could flip a rejected destination back to verified.
ALTER TABLE "payout_accounts"
  ADD COLUMN "verification_rejected_at" TIMESTAMPTZ;

-- Preserve explicit rejections that predate this column. Only the latest
-- verification decision for each payout account is authoritative: a later
-- manual verification intentionally clears an older rejection.
UPDATE "payout_accounts" AS pa
SET "verification_rejected_at" = latest."createdAt"
FROM (
  SELECT DISTINCT ON ("targetId")
    "targetId",
    "action",
    "createdAt"
  FROM "audit_logs"
  WHERE "targetType" = 'payout_account'
    AND "action" IN ('payout_account_verified', 'payout_account_rejected')
  ORDER BY "targetId", "createdAt" DESC, "id" DESC
) AS latest
WHERE pa."id" = latest."targetId"
  AND latest."action" = 'payout_account_rejected';
