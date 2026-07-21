-- Harden foreign-key delete rules for financial and audit records.
-- These tables were previously linked with ON DELETE CASCADE, which could
-- silently remove confirmed ledger entries, impressions, clicks, reports,
-- wait-state evidence, and payout history if a parent row were ever hard-deleted.
-- The application uses soft-delete (status='deleted' / anonymization) for users
-- and devices, but the schema must also protect against accidental hard deletes.
-- This migration converts the critical FKs to ON DELETE RESTRICT.

BEGIN;

-- ad_impressions: audit trail for every ad served
ALTER TABLE "ad_impressions" DROP CONSTRAINT IF EXISTS "ad_impressions_userId_fkey";
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_impressions" DROP CONSTRAINT IF EXISTS "ad_impressions_deviceId_fkey";
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ad_clicks: billing evidence; cannot remove impression if a billed click exists
ALTER TABLE "ad_clicks" DROP CONSTRAINT IF EXISTS "ad_clicks_impressionId_fkey";
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_impressionId_fkey"
  FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_clicks" DROP CONSTRAINT IF EXISTS "ad_clicks_userId_fkey";
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_clicks" DROP CONSTRAINT IF EXISTS "ad_clicks_deviceId_fkey";
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ad_reports: complaint/audit trail
ALTER TABLE "ad_reports" DROP CONSTRAINT IF EXISTS "ad_reports_impressionId_fkey";
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_impressionId_fkey"
  FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ad_reports" DROP CONSTRAINT IF EXISTS "ad_reports_userId_fkey";
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- earnings_ledger: immutable money records
ALTER TABLE "earnings_ledger" DROP CONSTRAINT IF EXISTS "earnings_ledger_userId_fkey";
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- advertiser_ledger: immutable advertiser spend records
ALTER TABLE "advertiser_ledger" DROP CONSTRAINT IF EXISTS "advertiser_ledger_advertiserId_fkey";
ALTER TABLE "advertiser_ledger" ADD CONSTRAINT "advertiser_ledger_advertiserId_fkey"
  FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- payout_requests: immutable payout history
ALTER TABLE "payout_requests" DROP CONSTRAINT IF EXISTS "payout_requests_userId_fkey";
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- payout_allocations: link between payouts and earnings
ALTER TABLE "payout_allocations" DROP CONSTRAINT IF EXISTS "payout_allocations_payoutRequestId_fkey";
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- payout_transactions: provider transaction audit trail
ALTER TABLE "payout_transactions" DROP CONSTRAINT IF EXISTS "payout_transactions_payoutRequestId_fkey";
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- wait_state_events: evidence justifying earnings
ALTER TABLE "wait_state_events" DROP CONSTRAINT IF EXISTS "wait_state_events_userId_fkey";
ALTER TABLE "wait_state_events" ADD CONSTRAINT "wait_state_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wait_state_events" DROP CONSTRAINT IF EXISTS "wait_state_events_deviceId_fkey";
ALTER TABLE "wait_state_events" ADD CONSTRAINT "wait_state_events_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- payout_accounts: tied to payout history; cannot delete user with accounts
ALTER TABLE "payout_accounts" DROP CONSTRAINT IF EXISTS "payout_accounts_userId_fkey";
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- payout_fence_release_approvals: payout audit trail
ALTER TABLE "payout_fence_release_approvals" DROP CONSTRAINT IF EXISTS "payout_fence_release_approvals_payoutAccountId_fkey";
ALTER TABLE "payout_fence_release_approvals" ADD CONSTRAINT "payout_fence_release_approvals_payoutAccountId_fkey"
  FOREIGN KEY ("payoutAccountId") REFERENCES "payout_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payout_fence_release_approvals" DROP CONSTRAINT IF EXISTS "payout_fence_release_approvals_payoutRequestId_fkey";
ALTER TABLE "payout_fence_release_approvals" ADD CONSTRAINT "payout_fence_release_approvals_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- referral_rewards: immutable referral money records
ALTER TABLE "referral_rewards" DROP CONSTRAINT IF EXISTS "referral_rewards_userId_fkey";
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
