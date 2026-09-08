-- Additive Wave 1 metadata only. No financial tables or settlement paths are changed.

CREATE TYPE "AttentionExperimentStatus" AS ENUM ('draft', 'running', 'paused', 'completed');
CREATE TYPE "AttentionExperimentEligibility" AS ENUM ('eligible', 'ineligible');
CREATE TYPE "AttentionModelStatus" AS ENUM ('candidate', 'shadow', 'approved', 'retired', 'revoked');
CREATE TYPE "AttentionModelFamily" AS ENUM ('advertiser_outcome', 'advertiser_retention', 'user_retention', 'cost');

CREATE TABLE "attention_experiments" (
  "id" TEXT NOT NULL,
  "status" "AttentionExperimentStatus" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "started_at" TIMESTAMPTZ,
  "ended_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_experiments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attention_experiments_status_started_at_idx"
  ON "attention_experiments"("status", "started_at");

CREATE TABLE "attention_experiment_assignments" (
  "id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "subject_key" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "eligibility" "AttentionExperimentEligibility" NOT NULL,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_experiment_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attention_experiment_assignments_experiment_id_subject_key_key"
  ON "attention_experiment_assignments"("experiment_id", "subject_key");
CREATE INDEX "attention_experiment_assignments_experiment_id_variant_idx"
  ON "attention_experiment_assignments"("experiment_id", "variant");
ALTER TABLE "attention_experiment_assignments"
  ADD CONSTRAINT "attention_experiment_assignments_experiment_id_fkey"
  FOREIGN KEY ("experiment_id") REFERENCES "attention_experiments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "attention_model_artifacts" (
  "id" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "model_version" TEXT NOT NULL,
  "model_family" "AttentionModelFamily" NOT NULL,
  "dataset_digest" TEXT NOT NULL,
  "feature_names" TEXT[] NOT NULL,
  "train_window_start" TIMESTAMPTZ NOT NULL,
  "train_window_end" TIMESTAMPTZ NOT NULL,
  "validation_start" TIMESTAMPTZ NOT NULL,
  "validation_end" TIMESTAMPTZ NOT NULL,
  "trained_at" TIMESTAMPTZ NOT NULL,
  "artifact_digest" TEXT NOT NULL,
  "status" "AttentionModelStatus" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_model_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attention_model_artifacts_model_id_model_version_key"
  ON "attention_model_artifacts"("model_id", "model_version");
CREATE INDEX "attention_model_artifacts_model_family_status_trained_at_idx"
  ON "attention_model_artifacts"("model_family", "status", "trained_at");
