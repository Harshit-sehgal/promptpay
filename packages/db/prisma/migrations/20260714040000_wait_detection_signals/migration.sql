-- Add confidence-based wait-detection metadata to wait_state_events.
-- Stores categorized telemetry signals (no user code), the computed
-- confidence, detector version, reason, and whether the user flagged it
-- as a false positive.
ALTER TABLE "wait_state_events"
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "detector_version" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "signals" JSONB DEFAULT '[]',
  ADD COLUMN "is_false_positive" BOOLEAN NOT NULL DEFAULT false;

-- Index for analytics/evaluation queries on confidence and false positives.
CREATE INDEX "wait_state_events_confidence_idx" ON "wait_state_events" ("confidence");
CREATE INDEX "wait_state_events_false_positive_idx" ON "wait_state_events" ("is_false_positive");
