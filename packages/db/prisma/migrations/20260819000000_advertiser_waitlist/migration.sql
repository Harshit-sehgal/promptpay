-- Advertiser waitlist (LAUNCH_PLAN Phase 2 step 11): captures advertiser
-- interest while billing is closed. The email is PII stored only in this
-- table; the audit trail records a row reference (targetType
-- 'advertiser_waitlist' + targetId), never the address, so erasure is a
-- single-row delete plus an indexed audit scrub by targetId
-- (scripts/erase-waitlist-signup.mjs).
CREATE TYPE "AdvertiserWaitlistStatus" AS ENUM ('pending', 'invited', 'onboarded', 'declined');

CREATE TABLE "advertiser_waitlist" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "company" TEXT,
  "country" TEXT,
  "status" "AdvertiserWaitlistStatus" NOT NULL DEFAULT 'pending',
  "consent" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'advertisers_page',
  "ip_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "advertiser_waitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advertiser_waitlist_email_key" ON "advertiser_waitlist"("email");

CREATE INDEX "advertiser_waitlist_status_created_at_idx" ON "advertiser_waitlist"("status", "created_at");
