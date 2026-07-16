import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from './__fixtures__/test-keys-2';
import { deriveKeyId } from './jwt-key-id';
import { decodeKid, loadVerificationKeySet, selectVerificationKey } from './jwt-keys';

function config(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

// Sign a payload with the given private key and stamp the `kid` header derived
// from the matching PUBLIC key, so verification can resolve the kid back to
// the same public key.
function signWithKid(
  privateKey: string,
  publicKey: string,
  payload: Record<string, unknown>,
): string {
  return new JwtService({
    privateKey,
    signOptions: { algorithm: 'RS256', keyid: deriveKeyId(publicKey) },
  }).sign(payload);
}

describe('loadVerificationKeySet', () => {
  it('loads a single key from JWT_PUBLIC_KEY', () => {
    const set = loadVerificationKeySet(config({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY }));
    expect(set.keys.size).toBe(1);
    expect(set.primaryKid).toBe(deriveKeyId(TEST_JWT_PUBLIC_KEY));
    expect(set.keys.get(set.primaryKid)).toBe(TEST_JWT_PUBLIC_KEY);
  });

  it('loads multiple keys from JWT_PUBLIC_KEYS (newline-separated)', () => {
    const set = loadVerificationKeySet(
      config({
        JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY_2,
        JWT_PUBLIC_KEYS: `${TEST_JWT_PUBLIC_KEY}\n${TEST_JWT_PUBLIC_KEY_2}`,
      }),
    );
    expect(set.keys.size).toBe(2);
    expect(set.keys.has(deriveKeyId(TEST_JWT_PUBLIC_KEY))).toBe(true);
    expect(set.keys.has(deriveKeyId(TEST_JWT_PUBLIC_KEY_2))).toBe(true);
    // primaryKid follows JWT_PUBLIC_KEY (current signing key).
    expect(set.primaryKid).toBe(deriveKeyId(TEST_JWT_PUBLIC_KEY_2));
  });

  it('tolerates literal "\\n" PEM escapes from .env files', () => {
    const escaped = TEST_JWT_PUBLIC_KEY.replace(/\n/g, '\\n');
    const set = loadVerificationKeySet(config({ JWT_PUBLIC_KEY: escaped }));
    expect(set.keys.size).toBe(1);
    expect(set.keys.get(set.primaryKid)).toBe(TEST_JWT_PUBLIC_KEY);
  });

  it('returns an empty set when no key is configured', () => {
    const set = loadVerificationKeySet(config({}));
    expect(set.keys.size).toBe(0);
    expect(set.primaryPem).toBe('');
  });
});

describe('decodeKid', () => {
  it('reads the kid header from a signed token', () => {
    const token = signWithKid(TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY, { sub: 'u1' });
    expect(decodeKid(token)).toBe(deriveKeyId(TEST_JWT_PUBLIC_KEY));
  });

  it('returns null for a malformed token', () => {
    expect(decodeKid('not-a-jwt')).toBeNull();
    expect(decodeKid('a.b')).toBeNull();
  });
});

describe('selectVerificationKey', () => {
  it('returns the PEM matching the token kid', () => {
    const set = loadVerificationKeySet(
      config({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY, JWT_PUBLIC_KEYS: TEST_JWT_PUBLIC_KEY_2 }),
    );
    const token = signWithKid(TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2, { sub: 'u1' });
    expect(selectVerificationKey(token, set)).toBe(TEST_JWT_PUBLIC_KEY_2);
  });

  it('verifies a token signed by the PREVIOUS key during rotation grace', () => {
    // Operator rotated to key #2 (JWT_PUBLIC_KEY) but still trusts key #1
    // (listed in JWT_PUBLIC_KEYS). A token signed with the old private key
    // must still resolve to the old public key — zero-downtime rotation.
    const set = loadVerificationKeySet(
      config({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY_2, JWT_PUBLIC_KEYS: TEST_JWT_PUBLIC_KEY }),
    );
    const oldToken = signWithKid(TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY, { sub: 'u1' });
    expect(selectVerificationKey(oldToken, set)).toBe(TEST_JWT_PUBLIC_KEY);
  });

  it('throws for an unknown kid (rotated-out key)', () => {
    const set = loadVerificationKeySet(config({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY }));
    const foreignToken = signWithKid(TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2, { sub: 'u1' });
    expect(() => selectVerificationKey(foreignToken, set)).toThrow(/unknown or rotated-out/);
  });

  it('throws for a token with no kid', () => {
    const set = loadVerificationKeySet(config({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY }));
    // Sign without keyid to produce a kid-less token.
    const noKidToken = new JwtService({
      privateKey: TEST_JWT_PRIVATE_KEY,
      signOptions: { algorithm: 'RS256' },
    }).sign({ sub: 'u1' });
    expect(() => selectVerificationKey(noKidToken, set)).toThrow(/missing a key id/);
  });
});
