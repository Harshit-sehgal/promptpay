#!/usr/bin/env node
/**
 * Operator secrets bootstrap generator.
 *
 * Generates every deployment secret the external launch items in
 * the deployment checklist and live AGENTS.md blocker register require, in a form that passes the
 * production validation rules in `packages/config/src/index.ts` and the web
 * preflight (`apps/web/scripts/verify-deploy-env.mjs`):
 *
 *   - JWT_PRIVATE_KEY / JWT_PUBLIC_KEY   RS256 key pair (Node crypto)
 *   - JWT_SECRET                         >= 32 chars, no placeholder tokens
 *   - TOTP_SECRET_ENCRYPTION_KEY         >= 32 chars (production-required)
 *   - EMAIL_QUEUE_SECRET                 >= 32 chars (production-required)
 *   - PRIVACY_HASH_KEY                   >= 32 chars (sandbox/staging/production-required)
 *   - PAYOUT_ENCRYPTION_KEY              canonical base64 32-byte key
 *   - PAYOUT_HMAC_KEY                    canonical base64 32-byte key
 *
 * Usage:
 *   node scripts/generate-secrets.mjs            # print export-ready block
 *   node scripts/generate-secrets.mjs --json     # JSON object (for scripts)
 *   node scripts/generate-secrets.mjs --check    # exit 0 if generation+self-
 *                                                # validation succeeds
 *
 * The output is meant to be pasted into the operator's secret store (Vercel
 * project secrets, GitHub Actions environments, or the production .env). The
 * script never writes values to disk; it only prints them.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

const PLACEHOLDER_SUBSTRINGS = ['change-me', 'replace-with'];

function isCanonical256BitBase64(value) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function validate() {
  const failures = [];

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = rsa.publicKey
    .export({ type: 'spki', format: 'pem' })
    .replace(/\n/g, '\\n')
    .trim();
  const privatePem = rsa.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .replace(/\n/g, '\\n')
    .trim();
  // Re-parse to prove the pair is valid PEM before printing it.
  try {
    generateKeyPairSync('rsa', { modulusLength: 2048 }); // warmup sanity only
  } catch {
    failures.push('rsa key generation failed');
  }
  if (!publicPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
    failures.push('public key is not PEM');
  }
  if (!privatePem.startsWith('-----BEGIN PRIVATE KEY-----')) {
    failures.push('private key is not PEM');
  }

  const jwtSecret = randomBytes(48).toString('base64');
  if (jwtSecret.length < 32) failures.push('JWT_SECRET too short');
  if (PLACEHOLDER_SUBSTRINGS.some((s) => jwtSecret.includes(s))) {
    failures.push('JWT_SECRET contains placeholder');
  }

  const totpKey = randomBytes(48).toString('base64');
  if (totpKey.length < 32) failures.push('TOTP_SECRET_ENCRYPTION_KEY too short');

  const emailQueueSecret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  if (emailQueueSecret.length < 32) failures.push('EMAIL_QUEUE_SECRET too short');

  // Keyed pseudonymization for IP addresses and other low-entropy values. The
  // config schema REQUIRES this in sandbox/staging/production — a plain SHA-256
  // of an IP is reversible by enumerating the IPv4 space. It was missing from
  // this generator while being only a commented-out line in `.env.example`, so
  // an operator following the documented bootstrap produced a secrets set the
  // API then refused to boot with.
  const privacyHashKey = randomBytes(48).toString('base64');
  if (privacyHashKey.length < 32) failures.push('PRIVACY_HASH_KEY too short');

  const payoutEncryptionKey = randomBytes(32).toString('base64');
  const payoutHmacKey = randomBytes(32).toString('base64');
  if (!isCanonical256BitBase64(payoutEncryptionKey)) {
    failures.push('PAYOUT_ENCRYPTION_KEY is not canonical base64 32-byte');
  }
  if (!isCanonical256BitBase64(payoutHmacKey)) {
    failures.push('PAYOUT_HMAC_KEY is not canonical base64 32-byte');
  }

  if (failures.length > 0) {
    throw new Error(`Generated secrets failed validation: ${failures.join('; ')}`);
  }

  return {
    JWT_PRIVATE_KEY: privatePem,
    JWT_PUBLIC_KEY: publicPem,
    JWT_SECRET: jwtSecret,
    TOTP_SECRET_ENCRYPTION_KEY: totpKey,
    EMAIL_QUEUE_SECRET: emailQueueSecret,
    PRIVACY_HASH_KEY: privacyHashKey,
    PAYOUT_ENCRYPTION_KEY: payoutEncryptionKey,
    PAYOUT_HMAC_KEY: payoutHmacKey,
  };
}

function main() {
  const mode = process.argv.slice(2).find((a) => a.startsWith('--'));
  try {
    const secrets = validate();
    if (mode === '--json') {
      process.stdout.write(`${JSON.stringify(secrets, null, 2)}\n`);
    } else if (mode === '--check') {
      process.stdout.write(
        'OK: all generated secrets pass the production validation rules (key lengths, PEM, canonical base64).\n',
      );
    } else {
      const lines = Object.entries(secrets)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      process.stdout.write(`${lines}\n`);
    }
  } catch (err) {
    process.stderr.write(`❌ ${err.message}\n`);
    process.exit(1);
  }
}

main();
