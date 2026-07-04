-- Round 7 follow-up: two schema↔DB reconciliations from the fresh sweep.

-- (1) referrals.referredId → ON DELETE CASCADE.
--   0_init created both referrals FKs as ON DELETE RESTRICT; the schema had
--   no onDelete annotation. RESTRICT on the referrer side is intentional
--   (preserve referrer earning history — referral_rewards.userId CASCADEs
--   on the referrer's own delete, but only if the referrer can be deleted).
--   RESTRICT on the referred side, however, needlessly blocked User
--   hard-delete when the only blocker was a referral row pointing at the
--   deleted account — a referral ceases to be meaningful once the referred
--   account is gone. Cascade the referred FK so the referral row (and its
--   CASCADE'd referral_rewards) clean up with the user. Referrer FK stays
--   RESTRICT → referrers can only be deleted after their referrals are
--   explicitly cleared.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referrals_referredId_fkey') THEN
    ALTER TABLE "referrals" DROP CONSTRAINT "referrals_referredId_fkey";
  END IF;
END $$;
ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_referredId_fkey"
    FOREIGN KEY ("referredId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- (2) webhook_events: unique(eventId) → unique(provider, eventId).
--   The idempotency floor was keyed on `eventId` alone, but different
--   providers maintain independent id namespaces; a global unique
--   constraint would wrongly collide two legitimate events from different
--   providers sharing an id. Drop the single-column unique and add the
--   composite. The composite also remains the primary idempotency key
--   used by the Stripe webhook controller.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'webhook_events_eventId_key'
  ) THEN
    ALTER TABLE "webhook_events" DROP CONSTRAINT "webhook_events_eventId_key";
  END IF;
END $$;
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_provider_eventId_key"
    UNIQUE ("provider", "eventId");
