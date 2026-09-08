#!/usr/bin/env node
/**
 * Validate the evidence bundle required before the adaptive marketplace can
 * enter a separately approved live-release process. This script only reads a
 * manifest and reports missing gates; it never changes switches, policies,
 * ledgers, rewards, payouts, or provider configuration.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REFERENCE_PROVIDER_PATTERN = /(?:stub|simulator|reference|ateva-local)/i;

export function validateAdaptiveReleaseEvidence(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (manifest.productionSwitchesRemainOff !== true) {
    errors.push('productionSwitchesRemainOff must be true while evidence is collected');
  }

  const provider = manifest.independentAttestation;
  if (!provider || typeof provider !== 'object') {
    errors.push('independentAttestation evidence is required');
  } else {
    if (!provider.providerId || typeof provider.providerId !== 'string') {
      errors.push('independentAttestation.providerId is required');
    } else if (REFERENCE_PROVIDER_PATTERN.test(provider.providerId)) {
      errors.push('independentAttestation.providerId cannot be a reference or simulator provider');
    }
    requireTrue(
      errors,
      provider.providerOperatedByIndependentParty,
      'providerOperatedByIndependentParty',
    );
    requireTrue(errors, provider.keyCustodyOutsideAteva, 'keyCustodyOutsideAteva');
    requirePositive(errors, provider.verifiedScenarioCount, 'verifiedScenarioCount');
    requireTrue(errors, provider.replayNegativeCasePassed, 'replayNegativeCasePassed');
    requireTrue(errors, provider.tamperNegativeCasePassed, 'tamperNegativeCasePassed');
    requireTrue(errors, provider.secondOperatorApproved, 'secondOperatorApproved');
  }

  const model = manifest.modelEvidence;
  if (!model || typeof model !== 'object') {
    errors.push('modelEvidence is required');
  } else {
    requireTrue(errors, model.temporalSplitPassed, 'modelEvidence.temporalSplitPassed');
    requireTrue(errors, model.leakageAuditPassed, 'modelEvidence.leakageAuditPassed');
    requireTrue(errors, model.calibrationReported, 'modelEvidence.calibrationReported');
    requireTrue(errors, model.uncertaintyReported, 'modelEvidence.uncertaintyReported');
    requireTrue(errors, model.rollbackDrillPassed, 'modelEvidence.rollbackDrillPassed');
    requireTrue(errors, model.humanApproval, 'modelEvidence.humanApproval');
    requireDigestList(errors, model.datasetDigests, 'modelEvidence.datasetDigests');
    requireDigestList(errors, model.artifactDigests, 'modelEvidence.artifactDigests');
  }

  const marketplace = manifest.marketplaceEvidence;
  if (!marketplace || typeof marketplace !== 'object') {
    errors.push('marketplaceEvidence is required');
  } else {
    requireTrue(
      errors,
      marketplace.advertiserBetaComplete,
      'marketplaceEvidence.advertiserBetaComplete',
    );
    requireTrue(errors, marketplace.userBetaComplete, 'marketplaceEvidence.userBetaComplete');
    requireTrue(errors, marketplace.legalReviewComplete, 'marketplaceEvidence.legalReviewComplete');
    requireTrue(
      errors,
      marketplace.paymentProviderReady,
      'marketplaceEvidence.paymentProviderReady',
    );
  }

  const canary = manifest.canaryEvidence;
  if (!canary || typeof canary !== 'object') {
    errors.push('canaryEvidence is required');
  } else {
    requireTrue(errors, canary.canaryPlanApproved, 'canaryEvidence.canaryPlanApproved');
    requireTrue(errors, canary.rollbackTested, 'canaryEvidence.rollbackTested');
    requireTrue(
      errors,
      canary.productionFreezeProcedureTested,
      'canaryEvidence.productionFreezeProcedureTested',
    );
  }
  return errors;
}

function requireTrue(errors, value, name) {
  if (value !== true) errors.push(`${name} must be true`);
}

function requirePositive(errors, value, name) {
  if (!Number.isInteger(value) || value < 1) errors.push(`${name} must be a positive integer`);
}

function requireDigestList(errors, value, name) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((digest) => !/^[a-f0-9]{64}$/i.test(digest))
  ) {
    errors.push(`${name} must contain at least one SHA-256 digest`);
  }
}

function loadManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const path = process.argv[2] ?? process.env.ADAPTIVE_RELEASE_EVIDENCE_MANIFEST;
  if (!path || !existsSync(path)) {
    console.error('FAIL  adaptive release evidence manifest is required');
    process.exit(1);
  }
  const errors = validateAdaptiveReleaseEvidence(loadManifest(path));
  if (errors.length) {
    for (const error of errors) console.error(`FAIL  ${error}`);
    process.exit(1);
  }
  console.log('PASS  adaptive release evidence is complete; production switches remain untouched');
}
