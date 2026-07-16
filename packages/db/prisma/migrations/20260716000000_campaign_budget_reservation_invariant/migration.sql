-- The reservation column was introduced separately from the earlier campaign
-- money constraints. Enforce the full budget invariant for both legacy rows and
-- every subsequent write without renaming the already-deployed physical column.

BEGIN;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_spent_reserved_within_budget"
    CHECK (
      "budgetSpentMinor"::numeric + "budget_reserved_minor"::numeric <= "budgetTotalMinor"::numeric
    ) NOT VALID;

DO $$
DECLARE
  invalid_campaigns bigint;
BEGIN
  SELECT count(*) INTO invalid_campaigns
  FROM "campaigns"
  WHERE "budgetSpentMinor"::numeric + "budget_reserved_minor"::numeric > "budgetTotalMinor"::numeric;

  IF invalid_campaigns > 0 THEN
    RAISE EXCEPTION 'Campaign budget reservation validation failed: % row(s) have spent + reserved above total', invalid_campaigns
      USING HINT = 'Repair the reported campaign budgets, retain an audit record of the correction, then rerun prisma migrate deploy.';
  END IF;
END $$;

ALTER TABLE "campaigns"
  VALIDATE CONSTRAINT "chk_campaigns_spent_reserved_within_budget";

COMMIT;
