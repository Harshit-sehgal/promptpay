-- Consent is deliberately independent from ads. Existing accounts stay opted
-- out until they explicitly grant telemetry consent through the API.
ALTER TABLE "user_settings"
  ADD COLUMN "wait_telemetry_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wait_telemetry_consent_at" TIMESTAMPTZ,
  ADD COLUMN "wait_telemetry_policy_version" TEXT;

-- Keep the old physical expires_at column as the short operation-start
-- deadline, then add a distinct consume deadline for long, single-use waits.
ALTER TABLE "wait_attestation_sessions"
  ADD COLUMN "consume_deadline" TIMESTAMPTZ;
UPDATE "wait_attestation_sessions"
  SET "consume_deadline" = "expires_at" + INTERVAL '30 minutes'
  WHERE "consume_deadline" IS NULL;
ALTER TABLE "wait_attestation_sessions"
  ALTER COLUMN "consume_deadline" SET NOT NULL;
CREATE INDEX "wait_attestation_sessions_consume_deadline_consumed_at_idx"
  ON "wait_attestation_sessions"("consume_deadline", "consumed_at");

-- Permanently bind a served impression to the session that established its
-- independent-proof attempt and make qualification/billing unambiguous.
ALTER TABLE "ad_impressions"
  ADD COLUMN "attestation_session_id" TEXT,
  ADD COLUMN "is_qualified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_authorized_at" TIMESTAMPTZ,
  ADD COLUMN "billed_at" TIMESTAMPTZ;
CREATE INDEX "ad_impressions_attestation_session_id_idx"
  ON "ad_impressions"("attestation_session_id");
ALTER TABLE "ad_impressions"
  ADD CONSTRAINT "ad_impressions_attestation_session_id_fkey"
  FOREIGN KEY ("attestation_session_id") REFERENCES "wait_attestation_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historical billable rows were already ledger-authorized by the prior
-- contract. Preserve their semantics while all new writes use explicit times.
UPDATE "ad_impressions"
  SET "is_qualified" = true
  WHERE "qualifiedAt" IS NOT NULL;
UPDATE "ad_impressions"
  SET "billing_authorized_at" = "qualifiedAt", "billed_at" = "qualifiedAt"
  WHERE "isBillable" = true AND "qualifiedAt" IS NOT NULL;
