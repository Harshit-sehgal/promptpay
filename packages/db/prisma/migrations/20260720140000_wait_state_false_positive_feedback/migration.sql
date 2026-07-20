-- P1 #16: persist user-reported false-positive feedback on wait states.
-- Previously the API discarded the client-supplied reason and stored only
-- is_false_positive=true, making the feedback unusable for detector-quality
-- evaluation. All columns nullable — existing rows are untouched.

ALTER TABLE "wait_state_events"
  ADD COLUMN "false_positive_reason" TEXT,
  ADD COLUMN "false_positive_note" TEXT,
  ADD COLUMN "false_positive_reported_at" TIMESTAMP(3);
