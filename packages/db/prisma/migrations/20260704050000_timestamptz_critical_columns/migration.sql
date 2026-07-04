-- Convert integrity-critical DateTime columns to TIMESTAMPTZ.
-- TIMESTAMP (without TZ) stores wall-clock values in the server's local
-- timezone. If a database or server timezone changes, comparisons like
-- `availableAt <= NOW()` shift silently, potentially maturing held
-- earnings earlier or later than intended. TIMESTAMPTZ normalizes to
-- UTC on input and converts to the session timezone on output — safe
-- against TZ drift.
--
-- NOT converted here: createdAt, updatedAt, renderedAt, and other
-- display/troubleshooting columns — those are informational and TZ
-- confusion there only affects UI display ("5 minutes ago"), not
-- money correctness.
--
-- Performed via USING clause: existing TIMESTAMP values are interpreted
-- as the server's current timezone (UTC by convention in Docker), so
-- `col AT TIME ZONE 'UTC'` produces identical temporal semantics.
-- No data loss: TIMESTAMPTZ stores the same instant, just with a +00
-- marker.

-- Sessions: token expiry
ALTER TABLE "sessions"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3)
  USING "expiresAt" AT TIME ZONE 'UTC';

-- API keys: key expiry
ALTER TABLE "api_keys"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3)
  USING "expiresAt" AT TIME ZONE 'UTC';

-- Ad impressions: qualification time (fraud window, billing timing)
ALTER TABLE "ad_impressions"
  ALTER COLUMN "qualifiedAt" TYPE TIMESTAMPTZ(3)
  USING "qualifiedAt" AT TIME ZONE 'UTC';

-- Fraud flags: resolution time
ALTER TABLE "fraud_flags"
  ALTER COLUMN "resolvedAt" TYPE TIMESTAMPTZ(3)
  USING "resolvedAt" AT TIME ZONE 'UTC';

-- Earnings ledger: payout maturation time (`availableAt <= NOW()` gates
-- whether earnings are withdrawable — TZ drift here is a money bug).
ALTER TABLE "earnings_ledger"
  ALTER COLUMN "availableAt" TYPE TIMESTAMPTZ(3)
  USING "availableAt" AT TIME ZONE 'UTC';