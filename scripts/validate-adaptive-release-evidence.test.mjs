import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAdaptiveReleaseEvidence } from './validate-adaptive-release-evidence.mjs';

const valid = {
  schemaVersion: 1,
  productionSwitchesRemainOff: true,
  independentAttestation: {
    providerId: 'independent-attestor',
    providerOperatedByIndependentParty: true,
    keyCustodyOutsideAteva: true,
    verifiedScenarioCount: 12,
    replayNegativeCasePassed: true,
    tamperNegativeCasePassed: true,
    secondOperatorApproved: true,
  },
  modelEvidence: {
    temporalSplitPassed: true,
    leakageAuditPassed: true,
    calibrationReported: true,
    uncertaintyReported: true,
    rollbackDrillPassed: true,
    humanApproval: true,
    datasetDigests: ['a'.repeat(64)],
    artifactDigests: ['b'.repeat(64)],
  },
  marketplaceEvidence: {
    advertiserBetaComplete: true,
    userBetaComplete: true,
    legalReviewComplete: true,
    paymentProviderReady: true,
  },
  canaryEvidence: {
    canaryPlanApproved: true,
    rollbackTested: true,
    productionFreezeProcedureTested: true,
  },
};

test('accepts a complete evidence bundle without enabling production', () => {
  assert.deepEqual(validateAdaptiveReleaseEvidence(valid), []);
});

test('fails closed for incomplete evidence and never substitutes the simulator', () => {
  const errors = validateAdaptiveReleaseEvidence({
    ...valid,
    independentAttestation: {
      ...valid.independentAttestation,
      providerId: 'reference-simulator',
      keyCustodyOutsideAteva: false,
      replayNegativeCasePassed: false,
    },
    productionSwitchesRemainOff: false,
  });
  assert.ok(errors.some((error) => error.includes('productionSwitchesRemainOff')));
  assert.ok(errors.some((error) => error.includes('reference or simulator')));
  assert.ok(errors.some((error) => error.includes('keyCustodyOutsideAteva')));
  assert.ok(errors.some((error) => error.includes('replayNegativeCasePassed')));
});

test('requires model, beta, legal, payment, and rollback evidence', () => {
  const errors = validateAdaptiveReleaseEvidence({ schemaVersion: 1 });
  for (const name of ['modelEvidence', 'marketplaceEvidence', 'canaryEvidence']) {
    assert.ok(
      errors.some((error) => error.startsWith(name)),
      name,
    );
  }
});
