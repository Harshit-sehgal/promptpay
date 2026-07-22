-- Keep expired unconsumed attestation sessions as audit rows. A served
-- impression references its session with ON DELETE RESTRICT, so deleting the
-- session can fail and prevent future cleanup runs from making progress.
ALTER TABLE "wait_attestation_sessions"
  ADD COLUMN "expired_at" TIMESTAMPTZ;

CREATE INDEX "wait_attestation_sessions_consume_deadline_consumed_expired_idx"
  ON "wait_attestation_sessions"("consume_deadline", "consumed_at", "expired_at");
