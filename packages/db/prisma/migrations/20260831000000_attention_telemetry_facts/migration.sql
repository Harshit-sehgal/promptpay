-- Additive telemetry/model metadata only.
-- No advertiser, campaign, impression, ledger, payout, or settlement rows are
-- created or changed by this migration.

ALTER TYPE "AttentionModelFamily"
  ADD VALUE IF NOT EXISTS 'fraud_quality_risk';

CREATE TYPE "AttentionAssignmentUnit" AS ENUM ('user', 'device', 'session');
CREATE TYPE "AttentionAttestationStatus" AS ENUM (
  'not_available',
  'unverified',
  'verified',
  'expired',
  'rejected'
);
CREATE TYPE "AttentionFraudRiskStatus" AS ENUM ('unknown', 'low', 'medium', 'high', 'blocked');

ALTER TABLE "attention_session_policy_assignments"
  ADD CONSTRAINT "attention_session_policy_assignments_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attention_experiments"
  ADD COLUMN "assignment_unit" "AttentionAssignmentUnit",
  ADD COLUMN "variants" JSONB,
  ADD COLUMN "assignment_started_at" TIMESTAMPTZ,
  ADD COLUMN "assignment_ended_at" TIMESTAMPTZ,
  ADD COLUMN "outcome_window_days" INTEGER,
  ADD COLUMN "primary_metric" TEXT,
  ADD COLUMN "guardrail_metrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "attention_experiment_assignments"
  ADD CONSTRAINT "attention_experiment_assignments_subject_key_digest_check"
  CHECK ("subject_key" ~ '^[a-f0-9]{64}$');

ALTER TABLE "attention_model_artifacts"
  ADD COLUMN "model_parameters" JSONB,
  ADD COLUMN "calibration" JSONB,
  ADD COLUMN "uncertainty" JSONB,
  ADD COLUMN "test_window_start" TIMESTAMPTZ,
  ADD COLUMN "test_window_end" TIMESTAMPTZ,
  ADD COLUMN "rollback_model_version" TEXT;

CREATE TABLE "attention_experiment_outcomes" (
  "id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "session_key" TEXT NOT NULL,
  "outcome_label" TEXT NOT NULL,
  "outcome_window_start" TIMESTAMPTZ NOT NULL,
  "outcome_window_end" TIMESTAMPTZ NOT NULL,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "experiment_variant" TEXT,
  "policy_version" INTEGER NOT NULL,
  "outcome_digest" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_experiment_outcomes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attention_experiment_outcomes_outcome_digest_key"
  ON "attention_experiment_outcomes"("outcome_digest");
ALTER TABLE "attention_experiment_outcomes"
  ADD CONSTRAINT "attention_experiment_outcomes_digest_check"
  CHECK (
    "session_key" ~ '^[a-f0-9]{64}$'
    AND "outcome_digest" ~ '^[a-f0-9]{64}$'
  );
CREATE UNIQUE INDEX "attention_experiment_outcomes_experiment_id_session_key_out_key"
  ON "attention_experiment_outcomes"("experiment_id", "session_key", "outcome_label", "outcome_window_start");
CREATE INDEX "attention_experiment_outcomes_experiment_id_observed_at_idx"
  ON "attention_experiment_outcomes"("experiment_id", "observed_at");
ALTER TABLE "attention_experiment_outcomes"
  ADD CONSTRAINT "attention_experiment_outcomes_experiment_id_fkey"
  FOREIGN KEY ("experiment_id") REFERENCES "attention_experiments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attention_pricing_policies"
  ADD CONSTRAINT "attention_pricing_policies_alpha_ppm_check"
  CHECK ("alpha_ppm" >= 0 AND "alpha_ppm" <= 1000000),
  ADD CONSTRAINT "attention_pricing_policies_passive_cap_ratio_ppm_check"
  CHECK ("passive_cap_ratio_ppm" >= 0 AND "passive_cap_ratio_ppm" <= 1000000),
  ADD CONSTRAINT "attention_pricing_policies_passive_session_cap_ms_check"
  CHECK ("passive_session_cap_ms" >= 0),
  ADD CONSTRAINT "attention_pricing_policies_minimum_qualified_ms_check"
  CHECK ("minimum_qualified_ms" >= 0);

-- A policy may move through a lifecycle status, but its versioned parameters,
-- digest, and lineage can never be edited in place after assignment.
CREATE OR REPLACE FUNCTION prevent_attention_policy_parameter_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.alpha_ppm IS DISTINCT FROM OLD.alpha_ppm
    OR NEW.passive_cap_ratio_ppm IS DISTINCT FROM OLD.passive_cap_ratio_ppm
    OR NEW.passive_session_cap_ms IS DISTINCT FROM OLD.passive_session_cap_ms
    OR NEW.minimum_qualified_ms IS DISTINCT FROM OLD.minimum_qualified_ms
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
    OR NEW.parent_policy_id IS DISTINCT FROM OLD.parent_policy_id
    OR NEW.optimizer_model_version IS DISTINCT FROM OLD.optimizer_model_version
    OR NEW.training_window IS DISTINCT FROM OLD.training_window
    OR NEW.experiment_id IS DISTINCT FROM OLD.experiment_id
    OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'attention policy version fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attention_pricing_policy_immutable_fields
BEFORE UPDATE ON "attention_pricing_policies"
FOR EACH ROW EXECUTE FUNCTION prevent_attention_policy_parameter_update();

CREATE OR REPLACE FUNCTION prevent_attention_session_assignment_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'attention session policy assignments are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attention_session_policy_assignment_immutable_fields
BEFORE UPDATE ON "attention_session_policy_assignments"
FOR EACH ROW EXECUTE FUNCTION prevent_attention_session_assignment_update();

CREATE TABLE "attention_session_facts" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "dataset_version" INTEGER NOT NULL,
  "session_key" TEXT NOT NULL,
  "user_key" TEXT NOT NULL,
  "device_key" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ NOT NULL,
  "session_started_at" TIMESTAMPTZ NOT NULL,
  "session_ended_at" TIMESTAMPTZ NOT NULL,
  "environment_kind" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "provider_class" TEXT NOT NULL,
  "integration_mode" TEXT NOT NULL,
  "tool_class" TEXT,
  "policy_version" INTEGER NOT NULL,
  "alpha_ppm" BIGINT NOT NULL,
  "passive_cap_ratio_ppm" BIGINT NOT NULL,
  "passive_session_cap_ms" INTEGER NOT NULL,
  "minimum_qualified_ms" INTEGER NOT NULL,
  "rendered_ms" INTEGER NOT NULL,
  "viewable_ms" INTEGER NOT NULL,
  "ai_eligible_ms" INTEGER NOT NULL,
  "qualified_ms" INTEGER NOT NULL,
  "passive_ms" INTEGER NOT NULL,
  "passive_billable_ms" INTEGER NOT NULL,
  "weighted_billable_ppm_ms" BIGINT NOT NULL,
  "attestation_status" "AttentionAttestationStatus" NOT NULL,
  "classification_confidence_ppm" BIGINT NOT NULL,
  "fraud_risk_status" "AttentionFraudRiskStatus" NOT NULL,
  "unknown_event_rate_ppm" BIGINT NOT NULL,
  "hypothetical_currency" TEXT,
  "hypothetical_advertiser_charge_minor" BIGINT,
  "hypothetical_user_reward_minor" BIGINT,
  "hypothetical_platform_contribution_minor" BIGINT,
  "economic_calculation_version" TEXT,
  "calculation_version" TEXT NOT NULL,
  "record_digest" TEXT NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_session_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attention_session_facts_session_id_key"
  ON "attention_session_facts"("session_id");
CREATE UNIQUE INDEX "attention_session_facts_record_digest_key"
  ON "attention_session_facts"("record_digest");
CREATE INDEX "attention_session_facts_observed_at_idx"
  ON "attention_session_facts"("observed_at");
CREATE INDEX "attention_session_facts_environment_kind_observed_at_idx"
  ON "attention_session_facts"("environment_kind", "observed_at");
CREATE INDEX "attention_session_facts_policy_version_observed_at_idx"
  ON "attention_session_facts"("policy_version", "observed_at");
CREATE INDEX "attention_session_facts_provider_class_observed_at_idx"
  ON "attention_session_facts"("provider_class", "observed_at");

ALTER TABLE "attention_session_facts"
  ADD CONSTRAINT "attention_session_facts_key_digest_check"
  CHECK (
    "session_key" ~ '^[a-f0-9]{64}$'
    AND "user_key" ~ '^[a-f0-9]{64}$'
    AND "device_key" ~ '^[a-f0-9]{64}$'
    AND "record_digest" ~ '^[a-f0-9]{64}$'
  );

-- A fact is an immutable dataset row. Corrections must be represented by a
-- new dataset version, never by editing the historical observation in place.
CREATE OR REPLACE FUNCTION prevent_attention_session_fact_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attention session facts are immutable';
END;
$$;
CREATE TRIGGER attention_session_fact_immutable_fields
BEFORE UPDATE ON "attention_session_facts"
FOR EACH ROW EXECUTE FUNCTION prevent_attention_session_fact_update();

ALTER TABLE "attention_session_facts"
  ADD CONSTRAINT "attention_session_facts_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
