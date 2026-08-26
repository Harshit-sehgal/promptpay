import { createPublicKey } from 'node:crypto';

// Accept the pre-rename `ATEVA_*` names. This script runs before any
// application code, so it cannot go through the `applyLegacyEnvAliases`
// shim in @ateva/config — the fallback has to be spelled out here or a
// deployment whose secrets still use the old prefix fails its preflight.
const requireDeployEnv =
  process.env.ATEVA_REQUIRE_DEPLOY_ENV ?? process.env.WAITLAYER_REQUIRE_DEPLOY_ENV;
const enforce = process.env.VERCEL === '1' || requireDeployEnv === '1';
const errors = [];
const environmentKind =
  process.env.NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND ??
  process.env.NEXT_PUBLIC_WAITLAYER_ENVIRONMENT_KIND ??
  'production';
if (!['development', 'test', 'sandbox', 'staging', 'production'].includes(environmentKind)) {
  errors.push(
    'NEXT_PUBLIC_ATEVA_ENVIRONMENT_KIND must be development, test, sandbox, staging, or production',
  );
}
if (errors.length > 0) {
  console.error('Deployment environment preflight failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
if (!enforce) {
  console.log('Deployment environment marker check passed.');
  process.exit(0);
}

const secret = process.env.JWT_SECRET ?? '';
const publicKey = (process.env.JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
const additionalPublicKeys = (process.env.JWT_PUBLIC_KEYS ?? '').replace(/\\n/g, '\n');
const apiUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || '';

function splitPublicKeys(raw) {
  const normalized = raw.trim();
  if (!normalized) return [];
  return (
    normalized.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g) ?? [normalized]
  ).map((pem) => pem.trim());
}

function validatePublicKey(pem, name) {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') errors.push(`${name} must contain only RSA public keys`);
  } catch {
    errors.push(`${name} must contain valid PEM public keys`);
  }
}

if (secret.length < 32) {
  errors.push('JWT_SECRET must be at least 32 characters for BFF identity signing');
}
if (!publicKey) {
  errors.push('JWT_PUBLIC_KEY is required at build time for protected-route verification');
} else {
  validatePublicKey(publicKey, 'JWT_PUBLIC_KEY');
}
for (const rotationKey of splitPublicKeys(additionalPublicKeys)) {
  validatePublicKey(rotationKey, 'JWT_PUBLIC_KEYS');
}

if (process.env.JWT_ISSUER !== undefined && !process.env.JWT_ISSUER.trim()) {
  errors.push('JWT_ISSUER must not be empty when configured');
}
if (process.env.JWT_AUDIENCE !== undefined && !process.env.JWT_AUDIENCE.trim()) {
  errors.push('JWT_AUDIENCE must not be empty when configured');
}

try {
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    errors.push('API_INTERNAL_URL or NEXT_PUBLIC_API_URL must be a credential-free HTTPS URL');
  }
} catch {
  errors.push('API_INTERNAL_URL or NEXT_PUBLIC_API_URL must be configured');
}

// Google Identity Services receives its client ID from the API at runtime via
// the same-origin /api/auth/config route. There is no web build-time Google ID
// to validate; requiring NEXT_PUBLIC_GOOGLE_CLIENT_ID here would allow a stale
// value to masquerade as the API verifier's audience.
if (process.env.NEXT_PUBLIC_ALLOW_MOCK_AUTH === 'true') {
  errors.push('NEXT_PUBLIC_ALLOW_MOCK_AUTH must not be enabled in a deployment');
}
if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'false') {
  errors.push('COOKIE_SECURE=false is not permitted in production');
}
if (process.env.NODE_ENV === 'production' && !process.env.BFF_TRUST_PROXY_HOPS) {
  errors.push('BFF_TRUST_PROXY_HOPS is required in production');
}

if (errors.length > 0) {
  console.error('Deployment environment preflight failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Deployment environment preflight passed.');
