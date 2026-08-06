-- The sandbox economy (WL-062/063/070-072) runs XTS house/test campaigns so a
-- sandbox developer exercises the full placement lifecycle without touching a
-- real settlement currency. The finite currency policy deliberately keeps XTS
-- out of every *settlement* surface (payout_accounts, payout_requests,
-- earnings_ledger, advertiser_ledger, platform_ledger, recovery_debt_cases,
-- referral_rewards, sandbox_* tables carry their own CHECKs), but the
-- `campaigns` CHECK blocked the house rows, so no XTS campaign could exist on
-- a migrated database. This is the policy + migration change the original
-- 20260713070000 comment anticipated: widen only `campaigns` to allow the
-- isolated test-credit code. XTS can still never flow into a real ledger:
-- the application policy rejects it everywhere else and `sandbox_*` tables
-- enforce `CHECK (currency = 'XTS')` on their own ledger.

BEGIN;

ALTER TABLE "campaigns" DROP CONSTRAINT "chk_campaigns_currency_iso";
ALTER TABLE "campaigns" ADD CONSTRAINT "chk_campaigns_currency_iso"
  CHECK ("currency" IN ('USD','EUR','GBP','CAD','AUD','INR','JPY','BRL','XTS')) NOT VALID;
ALTER TABLE "campaigns" VALIDATE CONSTRAINT "chk_campaigns_currency_iso";

COMMIT;