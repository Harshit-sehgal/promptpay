-- Add emergency-freeze flag to payout accounts.
-- A frozen account cannot be used for payouts until an admin unfreezes it,
-- even if it remains verified and active.
ALTER TABLE "payout_accounts" ADD COLUMN IF NOT EXISTS "is_frozen" BOOLEAN NOT NULL DEFAULT false;
