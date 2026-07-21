-- Add verified detector evidence to wait_state_events.
ALTER TABLE "wait_state_events" ADD COLUMN "evidence" JSONB;
