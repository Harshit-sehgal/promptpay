-- Money-integrity guardrails: DB-level CHECK constraints on monetary and
-- count columns. Application code already prevents negative amounts, but a
-- database constraint is the authoritative floor that survives any future
-- code path, bulk import, or manual fix.
--
-- Constraints are added NOT VALID so `migrate deploy` never fails against an
-- existing database that might contain legacy data; they are enforced for
-- every new INSERT/UPDATE going forward.

-- Ledger amounts must never be negative.
ALTER TABLE "earnings_ledger"
  ADD CONSTRAINT "chk_earnings_ledger_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

ALTER TABLE "advertiser_ledger"
  ADD CONSTRAINT "chk_advertiser_ledger_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

ALTER TABLE "platform_ledger"
  ADD CONSTRAINT "chk_platform_ledger_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

ALTER TABLE "payout_allocations"
  ADD CONSTRAINT "chk_payout_allocations_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

ALTER TABLE "recovery_debt_cases"
  ADD CONSTRAINT "chk_recovery_debt_cases_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

ALTER TABLE "referral_rewards"
  ADD CONSTRAINT "chk_referral_rewards_amount_nonneg" CHECK ("amountMinor" >= 0) NOT VALID;

-- Campaign bid must be strictly positive; spend and frequency caps non-negative.
ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_bid_positive" CHECK ("bidAmountMinor" > 0) NOT VALID;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_budget_spent_nonneg" CHECK ("budgetSpentMinor" >= 0) NOT VALID;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_freq_cap_per_hour_nonneg" CHECK ("frequencyCapPerHour" >= 0) NOT VALID;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "chk_campaigns_freq_cap_per_day_nonneg" CHECK ("frequencyCapPerDay" >= 0) NOT VALID;

-- Developer payout preferences: ads-per-hour cap non-negative.
ALTER TABLE "user_settings"
  ADD CONSTRAINT "chk_user_settings_max_ads_per_hour_nonneg" CHECK ("maxAdsPerHour" >= 0) NOT VALID;

-- Payout request amounts non-negative (approved amount is nullable).
ALTER TABLE "payout_requests"
  ADD CONSTRAINT "chk_payout_requests_requested_amount_nonneg" CHECK ("requestedAmountMinor" >= 0) NOT VALID;

ALTER TABLE "payout_requests"
  ADD CONSTRAINT "chk_payout_requests_approved_amount_nonneg"
    CHECK ("approvedAmountMinor" IS NULL OR "approvedAmountMinor" >= 0) NOT VALID;
