-- Environment identity is part of the signed protocol envelope and must remain
-- available on every persisted event for run isolation and audit evidence.
ALTER TABLE "agent_lifecycle_events"
  ADD COLUMN "environment_id" TEXT;

DO $$
DECLARE
  event_count BIGINT;
  marker_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO event_count FROM "agent_lifecycle_events";
  SELECT COUNT(*) INTO marker_count FROM "environment_markers";

  IF event_count > 0 AND marker_count <> 1 THEN
    RAISE EXCEPTION
      'Cannot backfill agent event environment identity: % events exist but % environment markers are present',
      event_count,
      marker_count;
  END IF;

  IF event_count > 0 AND NOT EXISTS (
    SELECT 1 FROM "environment_markers" WHERE "id" = 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill agent event environment identity: canonical environment marker id=1 is missing';
  END IF;

  IF event_count > 0 THEN
    UPDATE "agent_lifecycle_events" events
    SET "environment_id" = marker."environment_id"
    FROM "environment_markers" marker
    WHERE marker."id" = 1;
  END IF;
END $$;

ALTER TABLE "agent_lifecycle_events"
  ALTER COLUMN "environment_id" SET NOT NULL;
