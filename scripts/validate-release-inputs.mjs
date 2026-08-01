#!/usr/bin/env node
/**
 * Fail closed before a manual staging or production promotion starts. This is
 * dependency-free so it can run before an image build and be covered by the
 * root test gate.
 */
import { fileURLToPath } from 'node:url';

const REFERENCE_PROVIDER = 'waitlayer-stub-bridge';
const REFERENCE_VERSION = 'stub-v1';
const DIGEST_REFERENCE = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;

function fail(errors, message) {
  errors.push(message);
}

export function validateStagingInputs(env) {
  const errors = [];
  const provider = env.STAGING_WAIT_ATTESTATION_PROVIDER?.trim();
  const versions = (env.STAGING_WAIT_ATTESTATION_VERSIONS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  let issuers = [];

  if (!provider) fail(errors, 'STAGING_WAIT_ATTESTATION_PROVIDER is required');
  if (provider === REFERENCE_PROVIDER) {
    fail(
      errors,
      `${REFERENCE_PROVIDER} is a reference bridge and cannot satisfy a promotion smoke`,
    );
  }
  if (versions.length === 0) fail(errors, 'STAGING_WAIT_ATTESTATION_VERSIONS must not be empty');
  if (versions.includes(REFERENCE_VERSION)) {
    fail(
      errors,
      `${REFERENCE_VERSION} is a reference attestation version and cannot satisfy a promotion smoke`,
    );
  }
  try {
    const parsed = JSON.parse(env.STAGING_WAIT_ATTESTATION_ISSUERS ?? '');
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not a non-empty array');
    issuers = parsed;
  } catch {
    fail(errors, 'STAGING_WAIT_ATTESTATION_ISSUERS must be a non-empty JSON issuer array');
  }
  if (
    provider &&
    !issuers.some(
      (issuer) =>
        issuer &&
        typeof issuer === 'object' &&
        issuer.provider === provider &&
        typeof issuer.issuer === 'string' &&
        issuer.issuer.startsWith('https://') &&
        issuer.issuer !== 'https://waitlayer.local/attestation' &&
        issuer.publicKeys &&
        typeof issuer.publicKeys === 'object' &&
        Object.keys(issuer.publicKeys).length > 0,
    )
  ) {
    fail(
      errors,
      'STAGING_WAIT_ATTESTATION_ISSUERS must contain the selected independent HTTPS provider',
    );
  }
  return errors;
}

export function validateDigestInputs(env) {
  const errors = [];
  for (const name of ['STAGING_API_DIGEST', 'STAGING_WEB_DIGEST']) {
    const value = env[name]?.trim();
    if (!value || !DIGEST_REFERENCE.test(value)) {
      fail(errors, `${name} must be an immutable image@sha256:<64-hex> reference`);
    }
  }
  return errors;
}

export function validateReleaseInputs(env, mode = 'staging') {
  return mode === 'promotion' ? validateDigestInputs(env) : validateStagingInputs(env);
}

function main() {
  const mode = process.argv[2] === '--promotion' ? 'promotion' : 'staging';
  const errors = validateReleaseInputs(process.env, mode);
  if (errors.length) {
    for (const error of errors) console.error(`[release-input] ${error}`);
    process.exit(1);
  }
  console.log(`[release-input] ${mode} inputs are valid`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
