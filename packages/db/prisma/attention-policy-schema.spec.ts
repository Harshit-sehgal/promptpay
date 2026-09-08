import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(__dirname, 'schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(__dirname, 'migrations/20260830000000_attention_policy_metadata/migration.sql'),
  'utf8',
);
const metadataMigration = readFileSync(
  resolve(__dirname, 'migrations/20260830010000_attention_experiment_model_metadata/migration.sql'),
  'utf8',
);
const telemetryMigration = readFileSync(
  resolve(__dirname, 'migrations/20260831000000_attention_telemetry_facts/migration.sql'),
  'utf8',
);

describe('attention policy persistence contract', () => {
  it('defines only additive policy statuses and fixed-point fields', () => {
    expect(schema).toContain('enum AttentionPolicyStatus');
    expect(schema).toContain('model AttentionPricingPolicy');
    expect(schema).toContain('alphaPpm              BigInt');
    expect(schema).toContain('passiveCapRatioPpm    BigInt');
    expect(schema).toContain('model AttentionSessionPolicyAssignment');
    expect(schema).toContain('sessionId          String                 @unique');
  });

  it('defines experiment assignments and model artifacts as metadata only', () => {
    expect(schema).toContain('model AttentionExperimentAssignment');
    expect(schema).toContain('model AttentionModelArtifact');
    expect(schema).toContain('enum AttentionExperimentEligibility');
    expect(schema).toContain('enum AttentionModelFamily');
    expect(metadataMigration).toContain('CREATE TABLE "attention_experiments"');
    expect(metadataMigration).toContain('CREATE TABLE "attention_model_artifacts"');
    expect(schema).toContain('model AttentionExperimentOutcome');
    expect(schema).toContain('modelParameters   Json?');
    expect(telemetryMigration).toContain('CREATE TABLE "attention_experiment_outcomes"');
    expect(telemetryMigration).toContain('prevent_attention_policy_parameter_update');
    expect(telemetryMigration).toContain('attention_session_policy_assignment_immutable_fields');
    expect(telemetryMigration).toContain('attention_session_fact_immutable_fields');
    expect(telemetryMigration).toContain(
      'attention_experiment_assignments_subject_key_digest_check',
    );
    expect(telemetryMigration).toContain('attention_experiment_outcomes_digest_check');
    expect(telemetryMigration).toContain('attention_session_facts_key_digest_check');
  });

  it('does not couple the new models to financial domains', () => {
    const blocks = [
      schema.match(/model AttentionPricingPolicy \{[\s\S]*?\n\}/)?.[0] ?? '',
      schema.match(/model AttentionSessionPolicyAssignment \{[\s\S]*?\n\}/)?.[0] ?? '',
      schema.match(/model AttentionExperiment \{[\s\S]*?\n\}/)?.[0] ?? '',
      schema.match(/model AttentionExperimentAssignment \{[\s\S]*?\n\}/)?.[0] ?? '',
      schema.match(/model AttentionModelArtifact \{[\s\S]*?\n\}/)?.[0] ?? '',
      schema.match(/model AttentionExperimentOutcome \{[\s\S]*?\n\}/)?.[0] ?? '',
    ];
    const combined = blocks.join('\n');
    expect(combined).not.toMatch(/Ledger|Payout|Campaign|Advertiser|Earnings|Impression/);
    expect(combined).not.toContain('moneySwitch');
  });

  it('migrations are additive and create no financial-table writes', () => {
    expect(migration).toContain('CREATE TABLE "attention_pricing_policies"');
    expect(migration).toContain('CREATE TABLE "attention_session_policy_assignments"');
    expect(metadataMigration).not.toMatch(
      /(UPDATE|DELETE|DROP TABLE|INSERT INTO)\s+"?(advertiser_ledger|earnings_ledger|platform_ledger|ad_impressions)/i,
    );
    expect(migration).not.toMatch(
      /(UPDATE|DELETE|DROP TABLE|INSERT INTO)\s+"?(advertiser_ledger|earnings_ledger|platform_ledger|ad_impressions)/i,
    );
    expect(telemetryMigration).not.toMatch(
      /(UPDATE|DELETE|DROP TABLE|INSERT INTO)\s+"?(advertiser_ledger|earnings_ledger|platform_ledger|ad_impressions)/i,
    );
    expect(telemetryMigration).toContain('attention_pricing_policies_alpha_ppm_check');
  });
});
