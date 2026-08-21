#!/usr/bin/env node
/**
 * Fail closed before a manual staging or production promotion starts. This is
 * dependency-free so it can run before an image build and be covered by the
 * root test gate.
 */
import { createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REFERENCE_PROVIDER = 'ateva-stub-bridge';
const REFERENCE_VERSION = 'stub-v1';
const DIGEST_REFERENCE = /^[^\s@]+@sha256:[a-f0-9]{64}$/i;

function fail(errors, message) {
  errors.push(message);
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !value.endsWith('/') &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '::1'].includes(hostname)
    );
  } catch {
    return false;
  }
}

function isHttpsApiBase(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !value.endsWith('/') &&
      url.pathname === '/api/v1' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '::1'].includes(hostname)
    );
  } catch {
    return false;
  }
}

function isRsaPublicKey(value) {
  try {
    return createPublicKey(value.replace(/\\n/g, '\n').trim()).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

export function validateStagingInputs(env) {
  const errors = [];
  const provider = env.STAGING_WAIT_ATTESTATION_PROVIDER?.trim();
  const apiUrl = env.STAGING_API_URL?.trim();
  const webUrl = env.STAGING_WEB_URL?.trim();
  const versions = (env.STAGING_WAIT_ATTESTATION_VERSIONS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  let issuers = [];

  if (!apiUrl || !isHttpsOrigin(apiUrl)) {
    fail(
      errors,
      'STAGING_API_URL must be a credential-free HTTPS origin with no path or trailing slash',
    );
  }
  if (!webUrl || !isHttpsOrigin(webUrl)) {
    fail(
      errors,
      'STAGING_WEB_URL must be a credential-free HTTPS origin with no path or trailing slash',
    );
  }
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
        issuer.issuer !== 'https://ateva.local/attestation' &&
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

export function validateProductionWebInputs(env) {
  const errors = [];
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  const webUrl = env.NEXT_PUBLIC_WEB_URL?.trim();
  const googleClientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  const publicKey = env.JWT_PUBLIC_KEY?.trim();

  if (!apiUrl || !isHttpsApiBase(apiUrl)) {
    fail(
      errors,
      'NEXT_PUBLIC_API_URL must be a credential-free non-loopback HTTPS URL ending exactly in /api/v1',
    );
  }
  if (!webUrl || !isHttpsOrigin(webUrl)) {
    fail(
      errors,
      'NEXT_PUBLIC_WEB_URL must be a credential-free non-loopback HTTPS origin with no path or trailing slash',
    );
  }
  if (!googleClientId) {
    fail(errors, 'NEXT_PUBLIC_GOOGLE_CLIENT_ID is required for the production web build');
  }
  if (!publicKey || !isRsaPublicKey(publicKey)) {
    fail(errors, 'JWT_PUBLIC_KEY must be a valid RSA public key for the production web build');
  }
  return errors;
}

export function validateReleaseInputs(env, mode = 'staging') {
  if (mode === 'promotion') return validateDigestInputs(env);
  if (mode === 'production-web') return validateProductionWebInputs(env);
  return validateStagingInputs(env);
}

function main() {
  const mode =
    process.argv[2] === '--promotion'
      ? 'promotion'
      : process.argv[2] === '--production-web'
        ? 'production-web'
        : 'staging';
  const errors = validateReleaseInputs(process.env, mode);
  if (errors.length) {
    for (const error of errors) console.error(`[release-input] ${error}`);
    process.exit(1);
  }
  console.log(`[release-input] ${mode} inputs are valid`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
