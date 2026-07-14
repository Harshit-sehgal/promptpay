-- Add client-supplied idempotency key to payout requests.
-- Scoped to the user so different users' keys cannot collide, and a replayed
-- request returns the original payout instead of creating a duplicate.
ALTER TABLE "payout_requests" ADD COLUMN "idempotency_key" TEXT;

-- Unique constraint scoped to user. Postgres allows multiple NULLs, so optional
-- keys (legacy rows / requests without a key) remain valid.
ALTER TABLE "payout_requests"
  ADD CONSTRAINT "payout_requests_user_id_idempotency_key_key"
  UNIQUE ("userId", "idempotency_key");

-- Index for idempotency-key lookups.
CREATE INDEX "payout_requests_idempotency_key_idx" ON "payout_requests" ("idempotency_key");
