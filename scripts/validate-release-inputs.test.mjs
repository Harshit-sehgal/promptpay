import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDigestInputs, validateStagingInputs } from './validate-release-inputs.mjs';

const independentIssuer = JSON.stringify([
  {
    provider: 'independent-attestor',
    issuer: 'https://attestor.example.test',
    audience: 'waitlayer-client',
    publicKeys: { current: '-----BEGIN PUBLIC KEY-----example-----END PUBLIC KEY-----' },
  },
]);

test('accepts an independent staging attester', () => {
  assert.deepEqual(
    validateStagingInputs({
      STAGING_WAIT_ATTESTATION_PROVIDER: 'independent-attestor',
      STAGING_WAIT_ATTESTATION_ISSUERS: independentIssuer,
      STAGING_WAIT_ATTESTATION_VERSIONS: 'attestor-v2',
    }),
    [],
  );
});

test('rejects the repository reference attester and version', () => {
  const errors = validateStagingInputs({
    STAGING_WAIT_ATTESTATION_PROVIDER: 'waitlayer-stub-bridge',
    STAGING_WAIT_ATTESTATION_ISSUERS: JSON.stringify([
      {
        provider: 'waitlayer-stub-bridge',
        issuer: 'https://waitlayer.local/attestation',
        publicKeys: { stub: 'key' },
      },
    ]),
    STAGING_WAIT_ATTESTATION_VERSIONS: 'stub-v1',
  });
  assert.ok(errors.some((error) => error.includes('reference bridge')));
  assert.ok(errors.some((error) => error.includes('reference attestation version')));
});

test('requires immutable image digests for promotion', () => {
  assert.deepEqual(
    validateDigestInputs({
      STAGING_API_DIGEST: `registry.example/api@sha256:${'a'.repeat(64)}`,
      STAGING_WEB_DIGEST: `registry.example/web@sha256:${'b'.repeat(64)}`,
    }),
    [],
  );
  assert.equal(
    validateDigestInputs({
      STAGING_API_DIGEST: 'registry.example/api:staging',
      STAGING_WEB_DIGEST: `registry.example/web@sha256:${'b'.repeat(64)}`,
    }).length,
    1,
  );
});
