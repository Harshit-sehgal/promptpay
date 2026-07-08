-- Add missing `updatedAt` timestamps to mutable business entities that
-- previously only tracked `createdAt`. Append-only/immutable records
-- (events, ledgers, audit logs, sessions, tokens, consents) are intentionally
-- left without `updatedAt` since they are never mutated after insert.

ALTER TABLE "ad_reports" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "api_keys" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "webhook_events" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "referral_rewards" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "referrals" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
