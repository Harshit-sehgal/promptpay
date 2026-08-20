import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateEnvironment, findingFor, hasFailure } from './deploy-preflight.mjs';

/**
 * A preflight that cannot fail is worse than no preflight: it manufactures
 * confidence at exactly the moment an operator is deciding whether to serve
 * real users. These tests prove each check actually fires.
 *
 * `skipComposeCheck` is used throughout because the compose-override finding
 * depends on a file in the repo working tree, not on `env`.
 */
const VALID = {
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  JWT_SECRET: 'x'.repeat(48),
};

test('rejects a non-production NODE_ENV', () => {
  const findings = evaluateEnvironment(
    { ...VALID, NODE_ENV: 'development' },
    {
      skipComposeCheck: true,
    },
  );
  assert.equal(findingFor(findings, 'node-env').level, 'FAIL');
  assert.ok(hasFailure(findings));
});

test('rejects COOKIE_SECURE=false outright', () => {
  const findings = evaluateEnvironment(
    { ...VALID, COOKIE_SECURE: 'false' },
    {
      skipComposeCheck: true,
    },
  );
  assert.equal(findingFor(findings, 'cookie-secure').level, 'FAIL');
});

test('rejects every mock-authentication flag', () => {
  for (const key of ['ALLOW_MOCK_GOOGLE', 'MOCK_GOOGLE_ENABLED', 'NEXT_PUBLIC_ALLOW_MOCK_AUTH']) {
    const findings = evaluateEnvironment({ ...VALID, [key]: 'true' }, { skipComposeCheck: true });
    const finding = findingFor(findings, 'mock-auth');
    assert.equal(finding.level, 'FAIL', `${key}=true must fail`);
    assert.match(finding.detail, new RegExp(key));
  }
});

test('accepts mock flags that are explicitly false', () => {
  const findings = evaluateEnvironment(
    { ...VALID, ALLOW_MOCK_GOOGLE: 'false', MOCK_GOOGLE_ENABLED: '0' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'mock-auth').level, 'PASS');
});

test('rejects test-only throttle overrides on a production API', () => {
  // These exist for isolated CI APIs. On a public production API they silently
  // remove the abuse controls that protect the auth endpoints.
  const findings = evaluateEnvironment(
    { ...VALID, THROTTLE_AUTH_SHORT_LIMIT: '200' },
    { skipComposeCheck: true },
  );
  const finding = findingFor(findings, 'throttle-overrides');
  assert.equal(finding.level, 'FAIL');
  assert.match(finding.detail, /THROTTLE_AUTH_SHORT_LIMIT/);
});

test('rejects a short JWT_SECRET', () => {
  const findings = evaluateEnvironment(
    { ...VALID, JWT_SECRET: 'too-short' },
    {
      skipComposeCheck: true,
    },
  );
  assert.equal(findingFor(findings, 'jwt-secret').level, 'FAIL');
});

test('rejects the reference attestation bridge as an issuer', () => {
  // The stub bridge signs a fixed duration and its key is not independent of
  // the client. Allowing it would let the launch gate be satisfied by a
  // rubber stamp.
  for (const value of ['ateva-stub-bridge', '{"provider":"stub-v1"}']) {
    const findings = evaluateEnvironment(
      { ...VALID, WAIT_ATTESTATION_ISSUERS: value },
      { skipComposeCheck: true },
    );
    assert.equal(findingFor(findings, 'attestation').level, 'FAIL', `${value} must fail`);
  }
});

test('treats an absent attestation issuer as the expected pre-launch posture', () => {
  const findings = evaluateEnvironment(VALID, { skipComposeCheck: true });
  assert.equal(findingFor(findings, 'attestation').level, 'PASS');
});

test('warns rather than fails on a real configured issuer', () => {
  const findings = evaluateEnvironment(
    { ...VALID, WAIT_ATTESTATION_ISSUERS: '[{"provider":"acme","issuer":"https://a.example"}]' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'attestation').level, 'WARN');
});

test('a clean environment produces no failures beyond the config schema', () => {
  // The full @ateva/config schema needs DB/JWT/etc, which this unit test
  // deliberately does not supply; assert that every *other* check passes so a
  // future edit cannot make a check silently permissive.
  const findings = evaluateEnvironment(VALID, { skipComposeCheck: true });
  const unexpected = findings.filter((f) => f.level === 'FAIL' && f.name !== 'config-schema');
  assert.deepEqual(unexpected, []);
});

test('fails on a half-configured Stripe rail (secret without webhook secret)', () => {
  const findings = evaluateEnvironment(
    { ...VALID, STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: '' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'stripe-half-configured').level, 'FAIL');
});

test('passes on a fully-inactive Stripe rail', () => {
  const findings = evaluateEnvironment(VALID, { skipComposeCheck: true });
  assert.equal(findingFor(findings, 'stripe-half-configured').level, 'PASS');
});

test('fails on a half-configured Dodo rail (key without webhook secret or product id)', () => {
  for (const dodo of [
    { DODO_API_KEY: 'k', DODO_WEBHOOK_SECRET: '', DODO_PRODUCT_ID: 'pdt_1' },
    { DODO_API_KEY: 'k', DODO_WEBHOOK_SECRET: 'whsec_1', DODO_PRODUCT_ID: '' },
  ]) {
    const findings = evaluateEnvironment({ ...VALID, ...dodo }, { skipComposeCheck: true });
    assert.equal(
      findingFor(findings, 'dodo-half-configured').level,
      'FAIL',
      JSON.stringify(dodo),
    );
  }
});

test('fails on the Dodo test endpoint in production', () => {
  const findings = evaluateEnvironment(
    { ...VALID, DODO_BASE_URL: 'https://test.dodopayments.com' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'dodo-test-endpoint').level, 'FAIL');
});

test('fails when DEPOSIT_PROCESSOR=dodo but Dodo is not fully configured', () => {
  const findings = evaluateEnvironment(
    { ...VALID, DEPOSIT_PROCESSOR: 'dodo', DODO_API_KEY: 'k' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'deposit-processor').level, 'FAIL');
});

test('warns when the inactive Stripe rail is selected as the deposit processor', () => {
  const findings = evaluateEnvironment(
    { ...VALID, DEPOSIT_PROCESSOR: 'stripe' },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'deposit-processor').level, 'WARN');
});

test('passes the payment checks for a complete Dodo configuration', () => {
  const findings = evaluateEnvironment(
    {
      ...VALID,
      DODO_API_KEY: 'k',
      DODO_WEBHOOK_SECRET: 'whsec_1',
      DODO_PRODUCT_ID: 'pdt_1',
      DODO_BASE_URL: 'https://live.dodopayments.com',
      DEPOSIT_PROCESSOR: 'dodo',
    },
    { skipComposeCheck: true },
  );
  assert.equal(findingFor(findings, 'dodo-half-configured').level, 'PASS');
  assert.equal(findingFor(findings, 'dodo-test-endpoint').level, 'PASS');
  assert.equal(findingFor(findings, 'deposit-processor').level, 'PASS');
});
