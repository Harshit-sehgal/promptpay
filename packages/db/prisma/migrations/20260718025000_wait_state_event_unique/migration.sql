-- Round 39: Prevent duplicate wait_state_start / wait_state_end events for the
-- same client-issued waitStateId. The existing @@index([waitStateId, eventType])
-- does not enforce uniqueness per type — a client rotating idempotencyKeys can
-- create duplicate start/end rows. Fast-forward: the enum-typed eventType cannot
-- anchor a nullable partial index, so the constraint covers all event types in
-- one unique. Cleanup: deduplicate any pre-existing violations by keeping the
-- chronologically first row for each (waitStateId, eventType) pair; late arrivals
-- and cargo-culted duplicates are not monetary and will be cleaned as a side
-- effect of adding the constraint. The duplicate check in recordWaitStateStart
-- will catch new attempts at runtime with a graceful ConflictException.

-- Delete duplicate (waitStateId, eventType) rows keeping the earliest createdAt.
DELETE FROM "wait_state_events" a
USING "wait_state_events" b
WHERE
  a."waitStateId" = b."waitStateId"
  AND a."eventType" = b."eventType"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

CREATE UNIQUE INDEX "wait_state_events_waitStateId_eventType_key"
  ON "wait_state_events" ("waitStateId", "eventType");
