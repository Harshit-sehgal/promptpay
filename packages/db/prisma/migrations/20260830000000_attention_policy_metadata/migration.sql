-- Additive Wave 1 telemetry/shadow metadata only.
-- No existing billing, rewards, ledger, payout, or campaign tables are changed.

CREATE TYPE "AttentionPolicyStatus" AS ENUM (
  'draft',
  'shadow',
  'experiment',
  'canary',
  'active',
  'retired',
  'revoked'
);

CREATE TABLE "attention_pricing_policies" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AttentionPolicyStatus" NOT NULL,
  "alpha_ppm" BIGINT NOT NULL,
  "passive_cap_ratio_ppm" BIGINT NOT NULL,
  "passive_session_cap_ms" INTEGER NOT NULL,
  "minimum_qualified_ms" INTEGER NOT NULL,
  "effective_at" TIMESTAMPTZ NOT NULL,
  "retired_at" TIMESTAMPTZ,
  "parent_policy_id" TEXT,
  "optimizer_model_version" TEXT,
  "training_window" TEXT,
  "experiment_id" TEXT,
  "policy_digest" TEXT NOT NULL,
  "created_by" TEXT,
  "approved_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attention_pricing_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attention_pricing_policies_version_key"
  ON "attention_pricing_policies"("version");
CREATE INDEX "attention_pricing_policies_status_effective_at_idx"
  ON "attention_pricing_policies"("status", "effective_at");
CREATE INDEX "attention_pricing_policies_parent_policy_id_idx"
  ON "attention_pricing_policies"("parent_policy_id");

CREATE TABLE "attention_session_policy_assignments" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attention_session_policy_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attention_session_policy_assignments_session_id_key"
  ON "attention_session_policy_assignments"("session_id");
CREATE INDEX "attention_session_policy_assignments_policy_id_assigned_at_idx"
  ON "attention_session_policy_assignments"("policy_id", "assigned_at");

ALTER TABLE "attention_session_policy_assignments"
  ADD CONSTRAINT "attention_session_policy_assignments_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "attention_pricing_policies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
