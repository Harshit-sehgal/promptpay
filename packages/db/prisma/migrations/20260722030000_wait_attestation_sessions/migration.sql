-- Independent provider/server-signed wait attestation. Raw assertions and
-- nonces are intentionally never persisted; only nonce/assertion digests and
-- minimized binding metadata are retained.
CREATE TABLE "wait_attestation_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "wait_state_id" TEXT NOT NULL,
  "client_session_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wait_attestation_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wait_attestation_sessions_nonce_hash_key" ON "wait_attestation_sessions"("nonce_hash");
CREATE INDEX "wait_attestation_sessions_userId_deviceId_wait_state_id_idx" ON "wait_attestation_sessions"("userId", "deviceId", "wait_state_id");
CREATE INDEX "wait_attestation_sessions_expires_at_idx" ON "wait_attestation_sessions"("expires_at");
ALTER TABLE "wait_attestation_sessions" ADD CONSTRAINT "wait_attestation_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wait_attestation_sessions" ADD CONSTRAINT "wait_attestation_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "wait_attestations" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "wait_state_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "attestation_version" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "assertion_digest" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "ended_at" TIMESTAMPTZ NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wait_attestations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wait_attestations_duration_ms_check" CHECK ("duration_ms" >= 0)
);
CREATE UNIQUE INDEX "wait_attestations_session_id_key" ON "wait_attestations"("session_id");
CREATE UNIQUE INDEX "wait_attestations_provider_event_id_key" ON "wait_attestations"("provider_event_id");
CREATE UNIQUE INDEX "wait_attestations_user_id_device_id_wait_state_id_key" ON "wait_attestations"("user_id", "device_id", "wait_state_id");
CREATE INDEX "wait_attestations_provider_created_at_idx" ON "wait_attestations"("provider", "created_at");
CREATE INDEX "wait_attestations_user_id_device_id_wait_state_id_idx" ON "wait_attestations"("user_id", "device_id", "wait_state_id");
ALTER TABLE "wait_attestations" ADD CONSTRAINT "wait_attestations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "wait_attestation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
