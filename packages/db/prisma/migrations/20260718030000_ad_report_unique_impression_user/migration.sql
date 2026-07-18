-- Round 40: Prevent duplicate AdReport rows for the same (impressionId, userId)
-- pair. The existing findFirst + conditional create in reportAd races two
-- concurrent reports on the same impression — both pass `if (!report)`, both
-- insert a row, and both call reverseEarnings (idempotent for money but the
-- duplicate rows + double-audit-entries pollute forensics).
-- Deduplicate any pre-existing violations by keeping the chronologically first
-- row; late arrivals are not monetary and will be cleaned as a side effect
-- of adding the constraint. The trait will also catch P2002 at runtime.

DELETE FROM "ad_reports" a
USING "ad_reports" b
WHERE
  a.impression_id = b.impression_id
  AND a.user_id = b.user_id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX "ad_reports_impression_id_user_id_key"
  ON "ad_reports" ("impression_id", "user_id");