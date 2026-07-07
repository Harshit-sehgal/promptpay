-- The previous unique index on (userId, provider, isActive) accidentally
-- allowed only one inactive historical payout destination per user/provider.
-- Keep the actual invariant: at most one active payout destination, while
-- preserving inactive history for audit and destination-change review.
DROP INDEX IF EXISTS "payout_accounts_userId_provider_isActive_key";

CREATE INDEX IF NOT EXISTS "payout_accounts_userId_provider_isActive_idx"
  ON "payout_accounts" ("userId", "provider", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "payout_accounts_active_user_provider_key"
  ON "payout_accounts" ("userId", "provider")
  WHERE "isActive" = true;
