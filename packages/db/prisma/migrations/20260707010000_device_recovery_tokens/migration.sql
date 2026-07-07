-- Support-mediated extension device-secret recovery.
--
-- A user can already rotate a lost per-device HMAC secret by proving
-- possession of the old secret, re-entering their account password, or
-- presenting a matching Google ID token. Passwordless users on future
-- non-Google identity providers still need a safe operator-assisted path.
--
-- This table stores only a hash of short-lived one-time support tokens. The
-- extension endpoint atomically consumes a matching unused token before
-- rotating the device secret, and support/admin issuance revokes previous
-- unused tokens for the same device.
CREATE TABLE "device_recovery_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "reason" TEXT,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_recovery_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_recovery_tokens_tokenHash_key"
  ON "device_recovery_tokens" ("tokenHash");

CREATE INDEX "device_recovery_tokens_userId_deviceId_expiresAt_idx"
  ON "device_recovery_tokens" ("userId", "deviceId", "expiresAt");

CREATE INDEX "device_recovery_tokens_deviceId_usedAt_revokedAt_expiresAt_idx"
  ON "device_recovery_tokens" ("deviceId", "usedAt", "revokedAt", "expiresAt");

CREATE INDEX "device_recovery_tokens_createdByUserId_createdAt_idx"
  ON "device_recovery_tokens" ("createdByUserId", "createdAt");

ALTER TABLE "device_recovery_tokens"
  ADD CONSTRAINT "device_recovery_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_recovery_tokens"
  ADD CONSTRAINT "device_recovery_tokens_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_recovery_tokens"
  ADD CONSTRAINT "device_recovery_tokens_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
