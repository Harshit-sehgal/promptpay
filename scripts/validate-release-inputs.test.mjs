import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateDigestInputs,
  validateProductionWebInputs,
  validateStagingInputs,
} from './validate-release-inputs.mjs';

const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/staging.yml', import.meta.url),
  'utf8',
);
const productionCompose = readFileSync(
  new URL('../docs/ops/docker-compose.images.example.yml', import.meta.url),
  'utf8',
);
const webPreflight = readFileSync(
  new URL('../apps/web/scripts/verify-deploy-env.mjs', import.meta.url),
  'utf8',
);
const prismaConfig = readFileSync(
  new URL('../packages/db/prisma.config.ts', import.meta.url),
  'utf8',
);
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const developmentCompose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

const independentIssuer = JSON.stringify([
  {
    provider: 'independent-attestor',
    issuer: 'https://attestor.example.test',
    audience: 'ateva-client',
    publicKeys: { current: '-----BEGIN PUBLIC KEY-----example-----END PUBLIC KEY-----' },
  },
]);

const validStagingUrls = {
  STAGING_API_URL: 'https://staging-api.ateva.example',
  STAGING_WEB_URL: 'https://staging.ateva.example',
};

const testPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Jd6Pn76ufdNCvvJs1OS
YdmBrNlvuXcHBVwOh1KbHSMzmYS6HqnhHIsidugtb1O23OZ8B3JPIbMnw+bCyxqR
yhN08Y6YThZQ6UpEPx6fa3fuxRdbH/o6D37G7JpS0ySAa4Ej3z9PqQ6K36I9wM3l
NNP9MgKJrK4nkEzz8ZhKUhjZHgpEdXpylXRUiib0k+YeTgAljbMBQKU0YMkh1lGv
f/YUhIt1iuTFTrTtKyYicNLhSFhMJDmL1fWeRfdo3/h21HQLWTOAMXBgoDoDseMy
GwYOC8j6BoANjaBkRd9Rmtt29Bp4dCjGXQpR1jYuzk/wQKz/7VMSJvKPgiZ8C3Fn
iwIDAQAB
-----END PUBLIC KEY-----`;

test('accepts an independent staging attester', () => {
  assert.deepEqual(
    validateStagingInputs({
      ...validStagingUrls,
      STAGING_WAIT_ATTESTATION_PROVIDER: 'independent-attestor',
      STAGING_WAIT_ATTESTATION_ISSUERS: independentIssuer,
      STAGING_WAIT_ATTESTATION_VERSIONS: 'attestor-v2',
    }),
    [],
  );
});

test('rejects the repository reference attester and version', () => {
  const errors = validateStagingInputs({
    ...validStagingUrls,
    STAGING_WAIT_ATTESTATION_PROVIDER: 'ateva-stub-bridge',
    STAGING_WAIT_ATTESTATION_ISSUERS: JSON.stringify([
      {
        provider: 'ateva-stub-bridge',
        issuer: 'https://ateva.local/attestation',
        publicKeys: { stub: 'key' },
      },
    ]),
    STAGING_WAIT_ATTESTATION_VERSIONS: 'stub-v1',
  });
  assert.ok(errors.some((error) => error.includes('reference bridge')));
  assert.ok(errors.some((error) => error.includes('reference attestation version')));
});

test('requires canonical HTTPS staging origins before building public URLs', () => {
  const base = {
    STAGING_WAIT_ATTESTATION_PROVIDER: 'independent-attestor',
    STAGING_WAIT_ATTESTATION_ISSUERS: independentIssuer,
    STAGING_WAIT_ATTESTATION_VERSIONS: 'attestor-v2',
  };
  for (const [name, value] of [
    ['STAGING_API_URL', 'https://staging-api.ateva.example/api/v1'],
    ['STAGING_API_URL', 'https://staging-api.ateva.example/'],
    ['STAGING_API_URL', 'http://staging-api.ateva.example'],
    ['STAGING_WEB_URL', 'https://user:pass@staging.ateva.example'],
    ['STAGING_WEB_URL', 'https://staging.ateva.example/path'],
  ]) {
    const env = { ...validStagingUrls, ...base, [name]: value };
    assert.ok(
      validateStagingInputs(env).some((error) => error.startsWith(`${name} must`)),
      `${name}=${value} must be rejected`,
    );
  }
});

test('rejects known unowned project domains from public release inputs', () => {
  const staging = {
    ...validStagingUrls,
    STAGING_WAIT_ATTESTATION_PROVIDER: 'independent-attestor',
    STAGING_WAIT_ATTESTATION_ISSUERS: independentIssuer,
    STAGING_WAIT_ATTESTATION_VERSIONS: 'attestor-v2',
  };
  for (const [name, value] of [
    ['STAGING_API_URL', 'https://api.ateva.com'],
    ['STAGING_WEB_URL', 'https://www.ateva.dev'],
    ['STAGING_API_URL', 'https://api.waitlayer.com'],
  ]) {
    assert.ok(
      validateStagingInputs({ ...staging, [name]: value }).some((error) =>
        error.startsWith(`${name} must`),
      ),
      `${name}=${value} must be rejected`,
    );
  }

  const production = {
    NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1',
    NEXT_PUBLIC_WEB_URL: 'https://app.example.com',
    JWT_PUBLIC_KEY: testPublicKey,
  };
  for (const [name, value] of [
    ['NEXT_PUBLIC_API_URL', 'https://api.ateva.com/api/v1'],
    ['NEXT_PUBLIC_WEB_URL', 'https://ateva.dev'],
  ]) {
    assert.ok(
      validateProductionWebInputs({ ...production, [name]: value }).length > 0,
      `${name}=${value} must be rejected`,
    );
  }
});

test('rejects fully qualified trailing-dot forms of known unowned domains', () => {
  const staging = {
    ...validStagingUrls,
    STAGING_WAIT_ATTESTATION_PROVIDER: 'independent-attestor',
    STAGING_WAIT_ATTESTATION_ISSUERS: independentIssuer,
    STAGING_WAIT_ATTESTATION_VERSIONS: 'attestor-v2',
  };
  for (const [name, value] of [
    ['STAGING_API_URL', 'https://api.ateva.com.'],
    ['STAGING_WEB_URL', 'https://ateva.dev.'],
  ]) {
    assert.ok(
      validateStagingInputs({ ...staging, [name]: value }).some((error) =>
        error.startsWith(`${name} must`),
      ),
      `${name}=${value} must be rejected`,
    );
  }

  const production = {
    NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1',
    NEXT_PUBLIC_WEB_URL: 'https://app.example.com',
    JWT_PUBLIC_KEY: testPublicKey,
  };
  for (const [name, value] of [
    ['NEXT_PUBLIC_API_URL', 'https://api.waitlayer.com./api/v1'],
    ['NEXT_PUBLIC_WEB_URL', 'https://ateva.com.'],
  ]) {
    assert.ok(
      validateProductionWebInputs({ ...production, [name]: value }).length > 0,
      `${name}=${value} must be rejected`,
    );
  }
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

test('validates the exact public URLs and RSA key embedded in the production web image', () => {
  const valid = {
    NEXT_PUBLIC_API_URL: 'https://api.ateva.example/api/v1',
    NEXT_PUBLIC_WEB_URL: 'https://www.ateva.example',
    JWT_PUBLIC_KEY: testPublicKey,
  };
  assert.deepEqual(validateProductionWebInputs(valid), []);
  assert.deepEqual(
    validateProductionWebInputs({
      ...valid,
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'stale-client.apps.googleusercontent.com',
    }),
    [],
    'a legacy web Google ID must not affect production web validation',
  );

  for (const [name, value] of [
    ['NEXT_PUBLIC_API_URL', 'https://api.ateva.example'],
    ['NEXT_PUBLIC_API_URL', 'https://api.ateva.example/prefix/api/v1'],
    ['NEXT_PUBLIC_API_URL', 'https://user:pass@api.ateva.example/api/v1'],
    ['NEXT_PUBLIC_WEB_URL', 'https://www.ateva.example/path'],
    ['NEXT_PUBLIC_WEB_URL', 'https://localhost'],
    ['JWT_PUBLIC_KEY', 'not-a-public-key'],
  ]) {
    assert.ok(
      validateProductionWebInputs({ ...valid, [name]: value }).length > 0,
      `${name}=${value} must be rejected`,
    );
  }
});

test('release workflow does not require a separate web Google client ID', () => {
  assert.doesNotMatch(webPreflight, /process\.env\.NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(webPreflight, /NEXT_PUBLIC_GOOGLE_CLIENT_ID is required/);
  assert.doesNotMatch(releaseWorkflow, /NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(releaseWorkflow, /STAGING_GOOGLE_CLIENT_ID|PRODUCTION_GOOGLE_CLIENT_ID/);
});

test('development Compose does not carry a hardcoded Google client ID', () => {
  assert.match(developmentCompose, /GOOGLE_CLIENT_ID: \$\{GOOGLE_CLIENT_ID:-\}/);
  assert.doesNotMatch(developmentCompose, /GOOGLE_CLIENT_ID: \$\{GOOGLE_CLIENT_ID:-[^}]+\}/);
  assert.doesNotMatch(developmentCompose, /NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
});

test('release workflow configures Buildx and signs every pushed image digest', () => {
  const stagingJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf('  staging-smoke:'),
    releaseWorkflow.indexOf('  cleanup-staging-schema:'),
  );
  const productionJob = releaseWorkflow.slice(releaseWorkflow.indexOf('  promote-production:'));

  for (const [name, job] of [
    ['staging', stagingJob],
    ['production', productionJob],
  ]) {
    const setup = job.indexOf('docker/setup-buildx-action@');
    const build = job.indexOf('docker compose -f docker-compose.yml build --push');
    assert.notEqual(setup, -1, `${name} image job must set up Buildx`);
    assert.notEqual(build, -1, `${name} image job must build and push in one step`);
    assert.ok(setup < build, `${name} Buildx setup must precede the image build`);
    // This previously asserted `DOCKER_ATTEST: 'true'`, but compose-level
    // `provenance`/`sbom` keys are rejected outright by the compose plugin on
    // ubuntu-latest, so that switch drove nothing and the assertion certified a
    // capability the pipeline did not have. Assert the control that is real:
    // the pushed digests are cosign-signed (keyless, GitHub OIDC).
    assert.match(job, /cosign (sign|verify)/, `${name} images must be cosign-signed or verified`);
  }

  const digestValidation = stagingJob.indexOf('name: Validate resolved staging digests');
  const signing = stagingJob.indexOf('name: Sign staging image digests');
  assert.notEqual(digestValidation, -1, 'staging digests must be validated after registry push');
  assert.ok(digestValidation < signing, 'invalid digest output must fail before signing or deploy');
});

test('release workflow serializes deploys and builds a production-specific web digest', () => {
  assert.match(releaseWorkflow, /group: ateva-release/);
  assert.doesNotMatch(releaseWorkflow, /group: staging-release-\$\{\{/);
  assert.match(releaseWorkflow, /cancel-in-progress: false/);
  assert.doesNotMatch(releaseWorkflow, /cancel-in-progress: true/);
  assert.match(releaseWorkflow, /Build and push production-specific web image/);
  assert.match(releaseWorkflow, /JWT_PUBLIC_KEY: \$\{\{ secrets\.PRODUCTION_JWT_PUBLIC_KEY \}\}/);
  assert.match(releaseWorkflow, /NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND: production/);
  assert.match(releaseWorkflow, /NEXT_PUBLIC_ALLOW_MOCK_AUTH: 'false'/);
  assert.match(
    releaseWorkflow,
    /PRODUCTION_WEB_DIGEST: \$\{\{ steps\.production-web\.outputs\.digest \}\}/,
  );
  assert.match(releaseWorkflow, /export ATEVA_ENVIRONMENT_KIND=production/);
  assert.match(releaseWorkflow, /export ENABLE_STAGING_FAUCET=false/);
  assert.doesNotMatch(releaseWorkflow, /docker tag "\$STAGING_WEB_DIGEST"/);
  assert.doesNotMatch(releaseWorkflow, /ATEVA_WEB_IMAGE='\$STAGING_WEB_DIGEST'/);
  assert.doesNotMatch(releaseWorkflow, /PRODUCTION_WEB_DIGEST="?\$STAGING_WEB_DIGEST/);
});

test('production web source maps use a build-only least-privilege secret', () => {
  assert.match(
    releaseWorkflow,
    /SENTRY_AUTH_TOKEN: \$\{\{ secrets\.PRODUCTION_SENTRY_AUTH_TOKEN \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /for required in [^\n]*NEXT_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN; do/,
  );
  assert.match(dockerfile, /RUN --mount=type=secret,id=sentry_auth_token/);
  assert.doesNotMatch(dockerfile, /^(?:ARG|ENV)\s+SENTRY_AUTH_TOKEN/m);
  assert.match(developmentCompose, /sentry_auth_token:\s*\n\s*environment: SENTRY_AUTH_TOKEN/);
  assert.match(developmentCompose, /secrets:\s*\n\s*- sentry_auth_token/);
});

test('staging boots the shipped artifacts under production Node semantics', () => {
  const stagingJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf('  staging-smoke:'),
    releaseWorkflow.indexOf('  cleanup-staging-schema:'),
  );
  assert.match(stagingJob, /export NODE_ENV=production/);
  assert.match(stagingJob, /export ATEVA_ENVIRONMENT_KIND=staging/);
  assert.doesNotMatch(stagingJob, /export NODE_ENV=development/);
});

test('remote deployments cannot auto-load the development Compose override', () => {
  assert.doesNotMatch(releaseWorkflow, /docker compose (?:pull|up|ps)\b/);
  assert.match(
    releaseWorkflow,
    /docker compose --env-file \.env\.staging -f docs\/ops\/docker-compose\.images\.example\.yml up/,
  );
  assert.match(
    releaseWorkflow,
    /docker compose --env-file \.env\.production -f docs\/ops\/docker-compose\.images\.example\.yml up/,
  );
});

test('production promotion has an approval-gated first-deploy path and real web canaries', () => {
  assert.match(releaseWorkflow, /initial_production_deploy:/);
  assert.match(releaseWorkflow, /environment: production/);
  assert.match(releaseWorkflow, /rollback_available=false/);
  assert.match(releaseWorkflow, /\$WEB_ORIGIN\/api\/auth\/login/);
  assert.match(releaseWorkflow, /\$WEB_ORIGIN\/developer/);
  assert.match(releaseWorkflow, /auth\/\.well-known\/jwks\.json/);
  assert.match(releaseWorkflow, /deployed API JWKS does not contain the production web build key/);
  assert.doesNotMatch(releaseWorkflow, /verify BFF \+ auth loop/);
  assert.doesNotMatch(releaseWorkflow, /\$\{PRODUCTION_API_URL\}\/auth\/login/);
});

test('production image Compose declares the full fail-closed runtime contract', () => {
  for (const name of [
    'ATEVA_ENVIRONMENT_ID',
    'DATABASE_URL',
    'REDIS_URL',
    'API_BASE_URL',
    'WEB_BASE_URL',
    'ALLOWED_COUNTRIES',
    'ALLOWED_CURRENCIES',
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEY',
    'JWT_SECRET',
    'TOTP_SECRET_ENCRYPTION_KEY',
    'PRIVACY_HASH_KEY',
    'EMAIL_FROM',
    'EMAIL_QUEUE_SECRET',
    'OPS_ALERT_EMAIL',
    'RESEND_API_KEY',
    'GOOGLE_CLIENT_ID',
    'PAYOUT_ENCRYPTION_KEY',
    'PAYOUT_HMAC_KEY',
  ]) {
    assert.match(
      productionCompose,
      new RegExp(`${name}: \\$\\{${name}:\\?`),
      `${name} must fail Compose interpolation when absent`,
    );
  }

  assert.match(
    productionCompose,
    /ATEVA_ENVIRONMENT_KIND: \$\{ATEVA_ENVIRONMENT_KIND:-production\}/,
  );
  assert.equal(
    [...productionCompose.matchAll(/^\s+NODE_ENV: production$/gm)].length,
    2,
    'both shipped services must force production Node semantics',
  );
  assert.doesNotMatch(productionCompose, /NODE_ENV: \$\{/);
  assert.match(productionCompose, /WAIT_ATTESTATION_ISSUERS:\n/);
  assert.doesNotMatch(productionCompose, /WAIT_ATTESTATION_ISSUERS: \$\{/);
  assert.match(productionCompose, /ATEVA_REQUIRE_DEPLOY_ENV: '1'/);
  assert.doesNotMatch(productionCompose, /NEXT_PUBLIC_GOOGLE_CLIENT_ID/);
  assert.match(productionCompose, /NEXT_PUBLIC_ALLOW_MOCK_AUTH: 'false'/);
  assert.match(productionCompose, /ALLOW_MOCK_GOOGLE: 'false'/);
  assert.match(productionCompose, /MOCK_GOOGLE_ENABLED: '0'/);
});

test('Prisma CLI prefers DIRECT_URL while retaining DATABASE_URL fallback', () => {
  assert.match(
    prismaConfig,
    /const databaseUrl = process\.env\.DIRECT_URL \|\| process\.env\.DATABASE_URL;/,
  );
});
