import { createPublicKey, createSign, verify as cryptoVerify } from 'crypto';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './__fixtures__/test-keys';
import { TEST_JWT_PRIVATE_KEY_2, TEST_JWT_PUBLIC_KEY_2 } from './__fixtures__/test-keys-2';
import { buildJwks, pemToRsaJwk } from './jwks';
import { deriveKeyId } from './jwt-key-id';

/**
 * P1 #22 — the JWKS endpoint must emit standards-compliant RSA JWKs that an
 * independent consumer can verify tokens against. The verification below
 * deliberately does NOT use the issuing JWT library: it rebuilds a public
 * key from the JWKS document alone (`{kty, n, e}`) and verifies the
 * signature with node:crypto — a genuinely independent code path.
 */
function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function signRs256(payload: object, privateKey: string, kid: string): string {
  // Deliberately avoid jsonwebtoken / @nestjs/jwt in this test so the
  // verification path is independent of the issuing library.
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

describe('JWKS (P1 #22)', () => {
  it('emits a full RSA JWK with kty, kid, alg, use, n and e', () => {
    const jwk = pemToRsaJwk(TEST_JWT_PUBLIC_KEY);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.use).toBe('sig');
    expect(jwk.alg).toBe('RS256');
    expect(jwk.kid).toBe(deriveKeyId(TEST_JWT_PUBLIC_KEY));
    // 2048-bit RSA modulus is 256 bytes → 342/343 base64url chars; exponent AQAB (65537).
    expect(jwk.n.length).toBeGreaterThan(300);
    expect(jwk.e).toBe('AQAB');
    expect(jwk.n).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('a token verifies against a public key rebuilt from the JWKS document (independent path)', () => {
    const token = signRs256(
      { sub: 'user-1', jti: 'session-1', aud: ['waitlayer-client', 'access'] },
      TEST_JWT_PRIVATE_KEY,
      deriveKeyId(TEST_JWT_PUBLIC_KEY),
    );

    const doc = buildJwks(mockConfig({ JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY }));
    expect(doc.keys).toHaveLength(1);
    const jwk = doc.keys[0];

    // Rebuild the key from the document alone — no PEM, no jsonwebtoken.
    const rebuilt = createPublicKey({ key: jwk, format: 'jwk' });
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const valid = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      rebuilt,
      Buffer.from(signatureB64, 'base64url'),
    );
    expect(valid).toBe(true);

    // And the kid in the token header matches the document's kid.
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    expect(header.kid).toBe(jwk.kid);
  });

  it('emits every accepted key during rotation (primary + overlap keys)', () => {
    const doc = buildJwks(
      mockConfig({
        JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
        JWT_PUBLIC_KEYS: `${TEST_JWT_PUBLIC_KEY}\n${TEST_JWT_PUBLIC_KEY_2}`,
      }),
    );
    expect(doc.keys).toHaveLength(2);
    const kids = doc.keys.map((k) => k.kid);
    expect(kids).toContain(deriveKeyId(TEST_JWT_PUBLIC_KEY));
    expect(kids).toContain(deriveKeyId(TEST_JWT_PUBLIC_KEY_2));

    // A token signed by the ROTATED-OUT key still verifies via the document.
    const oldToken = signRs256(
      { sub: 'u', jti: 's' },
      TEST_JWT_PRIVATE_KEY_2,
      deriveKeyId(TEST_JWT_PUBLIC_KEY_2),
    );
    const jwk2 = doc.keys.find((k) => k.kid === deriveKeyId(TEST_JWT_PUBLIC_KEY_2))!;
    const rebuilt = createPublicKey({ key: jwk2, format: 'jwk' });
    const [h, p, s] = oldToken.split('.');
    expect(
      cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), rebuilt, Buffer.from(s, 'base64url')),
    ).toBe(true);
  });

  it('throws when no verification key is configured', () => {
    expect(() => buildJwks(mockConfig({}))).toThrow(/not configured/);
  });

  it('rejects a non-RSA or malformed key', () => {
    expect(() => pemToRsaJwk('not a pem')).toThrow();
  });
});
