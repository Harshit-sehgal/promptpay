-- Cross-field money invariants. NOT VALID preserves deployability with legacy
-- rows while making every subsequent insert/update obey the invariant.

BEGIN;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_budget_total_positive"
    CHECK ("budgetTotalMinor" > 0) NOT VALID,
  ADD CONSTRAINT "chk_campaigns_spend_within_budget"
    CHECK ("budgetSpentMinor" <= "budgetTotalMinor") NOT VALID;

ALTER TABLE "payout_requests"
  ADD CONSTRAINT "chk_payout_requests_requested_amount_positive"
    CHECK ("requestedAmountMinor" > 0) NOT VALID,
  ADD CONSTRAINT "chk_payout_requests_approved_amount_valid"
    CHECK (
      "approvedAmountMinor" IS NULL OR
      ("approvedAmountMinor" > 0 AND "approvedAmountMinor" <= "requestedAmountMinor")
    ) NOT VALID;

ALTER TABLE "payout_allocations"
  ADD CONSTRAINT "chk_payout_allocations_amount_positive"
    CHECK ("amountMinor" > 0) NOT VALID;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "payout_accounts"
  ADD CONSTRAINT "chk_payout_accounts_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "payout_requests"
  ADD CONSTRAINT "chk_payout_requests_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "earnings_ledger"
  ADD CONSTRAINT "chk_earnings_ledger_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "advertiser_ledger"
  ADD CONSTRAINT "chk_advertiser_ledger_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "platform_ledger"
  ADD CONSTRAINT "chk_platform_ledger_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "recovery_debt_cases"
  ADD CONSTRAINT "chk_recovery_debt_cases_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE "referral_rewards"
  ADD CONSTRAINT "chk_referral_rewards_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID;

COMMIT;
