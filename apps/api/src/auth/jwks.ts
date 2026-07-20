import { createPublicKey } from 'crypto';
import type { ConfigService } from '@nestjs/config';

import { deriveKeyId } from './jwt-key-id';
import { loadVerificationKeySet } from './jwt-keys';

/**
 * A JSON Web Key as defined by RFC 7517. Only the RSA members WaitLayer
 * emits are modelled here.
 */
export interface RsaJwk {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  /** Base64url-encoded modulus (RFC 7518 §6.3.1.1). */
  n: string;
  /** Base64url-encoded public exponent (RFC 7518 §6.3.1.2). */
  e: string;
}

export interface JwksDocument {
  keys: RsaJwk[];
}

/**
 * Convert a PEM-encoded RSA public key into a standards-compliant JWK.
 *
 * P1 #22: the previous JWKS document carried only `{kty, alg, use, kid}` —
 * without the modulus (`n`) and exponent (`e`) no standard JOSE consumer
 * could verify a token from it. Node's own `crypto` performs the ASN.1
 * parsing, so no new dependency is introduced.
 */
export function pemToRsaJwk(pem: string): RsaJwk {
  const exported = createPublicKey(pem).export({ format: 'jwk' }) as {
    kty?: string;
    n?: string;
    e?: string;
  };
  if (exported.kty !== 'RSA' || !exported.n || !exported.e) {
    throw new Error('Configured JWT public key is not a valid RSA public key');
  }
  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid: deriveKeyId(pem),
    n: exported.n,
    e: exported.e,
  };
}

/**
 * Build the JWKS document for the current verification key set. ALL accepted
 * keys are emitted (primary + rotation overlap keys from JWT_PUBLIC_KEYS), so
 * JWKS consumers keep verifying pre-rotation tokens until they expire.
 *
 * Throws when no verification key is configured — the controller maps this to
 * a clean 400 instead of serving an empty key set that would look like a
 * signing-key compromise.
 */
export function buildJwks(config: ConfigService): JwksDocument {
  const keySet = loadVerificationKeySet(config);
  if (keySet.keys.size === 0) {
    throw new Error('JWT_PUBLIC_KEY (or JWT_PUBLIC_KEYS) is not configured');
  }
  const keys = [...keySet.keys.values()].map(pemToRsaJwk);
  return { keys };
}
