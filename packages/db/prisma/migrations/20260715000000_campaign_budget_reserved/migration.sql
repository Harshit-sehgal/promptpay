-- Add a reserved-budget column so campaign budget can be atomically reserved
-- when an impression is served and converted to spent when qualified (or
-- released if the impression never qualifies).
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "budget_reserved_minor" BIGINT NOT NULL DEFAULT 0;

-- Enforce the invariant: spent + reserved never exceeds total budget.
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_budget_reserved_nonnegative"
    CHECK ("budget_reserved_minor" >= 0);

-- Help the planner when filtering campaigns by remaining budget.
CREATE INDEX "campaigns_status_budget_reserved_idx"
  ON "campaigns" ("status", "budget_reserved_minor");
