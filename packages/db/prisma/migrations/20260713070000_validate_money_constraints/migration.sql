-- Replace syntactic currency checks with the finite application policy. Adding
-- a currency now deliberately requires a policy + migration change.

BEGIN;
ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "chk_campaigns_currency_iso";
ALTER TABLE "payout_accounts" DROP CONSTRAINT IF EXISTS "chk_payout_accounts_currency_iso";
ALTER TABLE "payout_requests" DROP CONSTRAINT IF EXISTS "chk_payout_requests_currency_iso";
ALTER TABLE "earnings_ledger" DROP CONSTRAINT IF EXISTS "chk_earnings_ledger_currency_iso";
ALTER TABLE "advertiser_ledger" DROP CONSTRAINT IF EXISTS "chk_advertiser_ledger_currency_iso";
ALTER TABLE "platform_ledger" DROP CONSTRAINT IF EXISTS "chk_platform_ledger_currency_iso";
ALTER TABLE "recovery_debt_cases" DROP CONSTRAINT IF EXISTS "chk_recovery_debt_cases_currency_iso";
ALTER TABLE "referral_rewards" DROP CONSTRAINT IF EXISTS "chk_referral_rewards_currency_iso";

ALTER TABLE "campaigns" ADD CONSTRAINT "chk_campaigns_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "payout_accounts" ADD CONSTRAINT "chk_payout_accounts_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "payout_requests" ADD CONSTRAINT "chk_payout_requests_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "chk_earnings_ledger_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "advertiser_ledger" ADD CONSTRAINT "chk_advertiser_ledger_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "platform_ledger" ADD CONSTRAINT "chk_platform_ledger_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "recovery_debt_cases" ADD CONSTRAINT "chk_recovery_debt_cases_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;
ALTER TABLE "referral_rewards" ADD CONSTRAINT "chk_referral_rewards_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL')) NOT VALID;

-- Fail with actionable table/count diagnostics before certification. Operators
-- must repair the named legacy rows and rerun migrate deploy; silently leaving
-- NOT VALID constraints forever would make integrity claims unprovable.
DO $$
DECLARE
  problems text[];
BEGIN
  SELECT array_agg(problem) INTO problems
  FROM (
    SELECT 'earnings_ledger invalid amount/currency=' || count(*) AS problem FROM "earnings_ledger" WHERE "amountMinor" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'advertiser_ledger invalid amount/currency=' || count(*) FROM "advertiser_ledger" WHERE "amountMinor" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'platform_ledger invalid amount/currency=' || count(*) FROM "platform_ledger" WHERE "amountMinor" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'campaigns invalid budget/bid/caps/currency=' || count(*) FROM "campaigns" WHERE "bidAmountMinor" <= 0 OR "budgetTotalMinor" <= 0 OR "budgetSpentMinor" < 0 OR "budgetSpentMinor" > "budgetTotalMinor" OR "frequencyCapPerHour" < 0 OR "frequencyCapPerDay" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'payout_requests invalid amount/currency=' || count(*) FROM "payout_requests" WHERE "requestedAmountMinor" <= 0 OR ("approvedAmountMinor" IS NOT NULL AND ("approvedAmountMinor" <= 0 OR "approvedAmountMinor" > "requestedAmountMinor")) OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'payout_allocations non-positive amount=' || count(*) FROM "payout_allocations" WHERE "amountMinor" <= 0 HAVING count(*) > 0
    UNION ALL SELECT 'payout_accounts unsupported currency=' || count(*) FROM "payout_accounts" WHERE "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'recovery_debt_cases invalid amount/currency=' || count(*) FROM "recovery_debt_cases" WHERE "amountMinor" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'referral_rewards invalid amount/currency=' || count(*) FROM "referral_rewards" WHERE "amountMinor" < 0 OR "currency" NOT IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL') HAVING count(*) > 0
    UNION ALL SELECT 'user_settings negative maxAdsPerHour=' || count(*) FROM "user_settings" WHERE "maxAdsPerHour" < 0 HAVING count(*) > 0
  ) diagnostics;

  IF coalesce(array_length(problems, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Money constraint validation failed: %', array_to_string(problems, '; ')
      USING HINT = 'Repair the reported legacy rows, retain an audit record of the correction, then rerun prisma migrate deploy.';
  END IF;
END $$;

ALTER TABLE "earnings_ledger" VALIDATE CONSTRAINT "chk_earnings_ledger_amount_nonneg";
ALTER TABLE "advertiser_ledger" VALIDATE CONSTRAINT "chk_advertiser_ledger_amount_nonneg";
ALTER TABLE "platform_ledger" VALIDATE CONSTRAINT "chk_platform_ledger_amount_nonneg";
ALTER TABLE "payout_allocations" VALIDATE CONSTRAINT "chk_payout_allocations_amount_nonneg";
ALTER TABLE "payout_allocations" VALIDATE CONSTRAINT "chk_payout_allocations_amount_positive";
ALTER TABLE "recovery_debt_cases" VALIDATE CONSTRAINT "chk_recovery_debt_cases_amount_nonneg";
ALTER TABLE "referral_rewards" VALIDATE CONSTRAINT "chk_referral_rewards_amount_nonneg";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_bid_positive";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_budget_spent_nonneg";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_budget_total_positive";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_spend_within_budget";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_freq_cap_per_hour_nonneg";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_freq_cap_per_day_nonneg";
ALTER TABLE "user_settings" VALIDATE CONSTRAINT "chk_user_settings_max_ads_per_hour_nonneg";
ALTER TABLE "payout_requests" VALIDATE CONSTRAINT "chk_payout_requests_requested_amount_nonneg";
ALTER TABLE "payout_requests" VALIDATE CONSTRAINT "chk_payout_requests_approved_amount_nonneg";
ALTER TABLE "payout_requests" VALIDATE CONSTRAINT "chk_payout_requests_requested_amount_positive";
ALTER TABLE "payout_requests" VALIDATE CONSTRAINT "chk_payout_requests_approved_amount_valid";
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_currency_iso";
ALTER TABLE "payout_accounts" VALIDATE CONSTRAINT "chk_payout_accounts_currency_iso";
ALTER TABLE "payout_requests" VALIDATE CONSTRAINT "chk_payout_requests_currency_iso";
ALTER TABLE "earnings_ledger" VALIDATE CONSTRAINT "chk_earnings_ledger_currency_iso";
ALTER TABLE "advertiser_ledger" VALIDATE CONSTRAINT "chk_advertiser_ledger_currency_iso";
ALTER TABLE "platform_ledger" VALIDATE CONSTRAINT "chk_platform_ledger_currency_iso";
ALTER TABLE "recovery_debt_cases" VALIDATE CONSTRAINT "chk_recovery_debt_cases_currency_iso";
ALTER TABLE "referral_rewards" VALIDATE CONSTRAINT "chk_referral_rewards_currency_iso";

COMMIT;
