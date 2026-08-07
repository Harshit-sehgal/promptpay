import { createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './__fixtures__/test-keys';
import { TEST_JWT_PUBLIC_KEY_2 } from './__fixtures__/test-keys-2';
import { createJwtModuleOptions } from './auth.module';
import { normalizePem, validateJwtSigningKeyPair } from './jwt-keys';

/**
 * A-097 regression: the RS256 **signing** key must tolerate the `\n`-escaped
 * single-line PEM form.
 *
 * Deployments are documented (AGENTS.md, docker-compose.yml, .env.example) to
 * store PEMs as single-line values with literal `\n` escapes, because Docker
 * Compose and `--env-file` cannot carry multi-line values. The verification
 * path normalised those escapes; the signing path did not — it passed the raw
 * config value straight to `jsonwebtoken`.
 *
 * The result was a production API that booted cleanly, reported
 * `GET /health` 200 with `database: connected`, served every public page — and
 * then failed EVERY login, signup, and refresh with HTTP 500
 * "secretOrPrivateKey must be an asymmetric key when using RS256". Found
 * 2026-08-07 by booting the real production image, not by any unit test.
 *
 * Nothing caught it because both `test-setup.ts` and `.e2e/run-e2e.sh` inject
 * real multi-line PEMs, so the escaped form — the only form a real deployment
 * uses — was never exercised anywhere in the suite. These tests exercise it.
 */
describe('A-097 — RS256 signing tolerates escaped PEMs', () => {
  const escapedPrivate = TEST_JWT_PRIVATE_KEY.replace(/\n/g, '\\n');
  const escapedPublic = TEST_JWT_PUBLIC_KEY.replace(/\n/g, '\\n');

  it('the escaped form is genuinely unusable raw (proves the bug was real)', () => {
    // Guard the premise: if this ever stops throwing, the rest of this file is
    // testing nothing.
    expect(() => createSign('RSA-SHA256').update('x').sign(escapedPrivate)).toThrow();
  });

  it('normalizePem restores a signable private key', () => {
    const signature = createSign('RSA-SHA256')
      .update('waitlayer')
      .sign(normalizePem(escapedPrivate));
    expect(signature.length).toBeGreaterThan(0);
  });

  it('a signature made from the normalised private key verifies against the public key', () => {
    const payload = 'waitlayer-a097';
    const signature = createSign('RSA-SHA256').update(payload).sign(normalizePem(escapedPrivate));
    const { createVerify } = require('node:crypto') as typeof import('node:crypto');
    const verified = createVerify('RSA-SHA256')
      .update(payload)
      .verify(normalizePem(escapedPublic), signature);
    expect(verified).toBe(true);
  });

  it('normalizePem is idempotent, so an already-real PEM is untouched', () => {
    // Deployments that DO manage to supply a multi-line PEM (Kubernetes
    // secrets, mounted files) must keep working.
    expect(normalizePem(TEST_JWT_PRIVATE_KEY)).toBe(TEST_JWT_PRIVATE_KEY.trim());
    expect(normalizePem(normalizePem(escapedPrivate))).toBe(normalizePem(escapedPrivate));
  });

  it('both PEM forms normalise to the same key material', () => {
    expect(normalizePem(escapedPrivate)).toBe(TEST_JWT_PRIVATE_KEY.trim());
    expect(normalizePem(escapedPublic)).toBe(TEST_JWT_PUBLIC_KEY.trim());
  });
});

describe('RS256 signing key-pair startup validation', () => {
  it('accepts a matching multiline private/public pair', () => {
    expect(validateJwtSigningKeyPair(TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY)).toEqual({
      privateKey: TEST_JWT_PRIVATE_KEY,
      publicKey: TEST_JWT_PUBLIC_KEY,
    });
  });

  it('accepts and normalises a matching literal-\\n escaped pair', () => {
    const escapedPrivate = TEST_JWT_PRIVATE_KEY.replace(/\n/g, '\\n');
    const escapedPublic = TEST_JWT_PUBLIC_KEY.replace(/\n/g, '\\n');

    expect(validateJwtSigningKeyPair(escapedPrivate, escapedPublic)).toEqual({
      privateKey: TEST_JWT_PRIVATE_KEY,
      publicKey: TEST_JWT_PUBLIC_KEY,
    });
  });

  it('rejects mismatched valid keys in their deployment escaped form', () => {
    const escapedPrivate = TEST_JWT_PRIVATE_KEY.replace(/\n/g, '\\n');
    const escapedWrongPublic = TEST_JWT_PUBLIC_KEY_2.replace(/\n/g, '\\n');
    const config = new ConfigService({
      JWT_PRIVATE_KEY: escapedPrivate,
      JWT_PUBLIC_KEY: escapedWrongPublic,
    });

    expect(() => createJwtModuleOptions(config)).toThrow(
      'JWT_PRIVATE_KEY does not match JWT_PUBLIC_KEY; refusing to start.',
    );
  });

  it('rejects malformed PEM input without echoing key material', () => {
    expect(() => validateJwtSigningKeyPair('not-a-private-key', TEST_JWT_PUBLIC_KEY)).toThrow(
      'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be valid RSA PEM keys.',
    );
  });
});
