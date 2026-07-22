-- Forward-only hardening: an attestation with zero duration cannot represent a
-- completed provider operation and must never authorize settlement.
ALTER TABLE "wait_attestations"
  DROP CONSTRAINT "wait_attestations_duration_ms_check";

ALTER TABLE "wait_attestations"
  ADD CONSTRAINT "wait_attestations_duration_ms_check"
  CHECK ("duration_ms" > 0);
