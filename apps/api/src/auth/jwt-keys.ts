import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { deriveKeyId } from './jwt-key-id';

/**
 * JWT verification key set supporting zero-downtime key rotation.
 *
 * Signing always emits a `kid` header derived from the signing public key
 * (see auth.module.ts). Verification resolves the token's `kid` against the set
 * of accepted public keys, so a freshly rotated key pair can be deployed while
 * the previous key remains in the set — pre-rotation access tokens continue to
 * verify until they naturally expire (~15m), then the old key is retired.
 *
 * Operationally an operator rotates by:
 *   1. deploying with `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` = new pair AND
 *      `JWT_PUBLIC_KEYS` = "<new pub>\n<old pub>";
 *   2. waiting one access-token TTL (default 15m);
 *   3. deploying again with only the new pair (dropping `JWT_PUBLIC_KEYS`).
 *
 * This file deliberately knows nothing about the signing private key.
 */

export interface VerificationKeySet {
  /** kid -> PEM. Empty when no verification key is configured. */
  keys: Map<string, string>;
  /** PEM matching the current signing key (used to derive the expected kid). */
  primaryPem: string;
  primaryKid: string;
}

/**
 * Normalise a PEM string that may carry literal "\n" escape sequences (as
 * written in .env files) into real newline-separated PEM text.
 */
function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

/**
 * Split a blob that may contain one or more concatenated PEM PUBLIC KEY blocks
 * into individual PEM strings. Tolerates literal "\n" escapes.
 */
function splitPublicKeys(raw: string): string[] {
  const normalized = normalizePem(raw);
  return normalized
    .split(/-----END PUBLIC KEY-----/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => `${chunk}\n-----END PUBLIC KEY-----`);
}

export function loadVerificationKeySet(config: ConfigService): VerificationKeySet {
  const plural = config.get<string>('JWT_PUBLIC_KEYS');
  const primary = config.get<string>('JWT_PUBLIC_KEY');

  const pems: string[] = [];
  if (plural && plural.trim()) {
    for (const pem of splitPublicKeys(plural)) pems.push(pem);
  }
  if (primary && primary.trim()) {
    const normed = normalizePem(primary);
    if (!pems.includes(normed)) pems.push(normed);
  }

  const keys = new Map<string, string>();
  for (const pem of pems) {
    keys.set(deriveKeyId(pem), pem);
  }

  const primaryPem = primary && primary.trim() ? normalizePem(primary) : (pems[0] ?? '');
  return {
    keys,
    primaryPem,
    primaryKid: primaryPem ? deriveKeyId(primaryPem) : '',
  };
}

/** Decode the `kid` header from a raw JWT string, or null when absent/invalid. */
export function decodeKid(rawToken: string): string | null {
  const parts = rawToken.split('.');
  if (parts.length < 2) return null;
  try {
    const header = Buffer.from(parts[0], 'base64url').toString('utf8');
    const parsed = JSON.parse(header) as { kid?: unknown };
    return typeof parsed.kid === 'string' ? parsed.kid : null;
  } catch {
    return null;
  }
}

/**
 * Select the verification PEM for a given raw JWT, honouring its `kid` header.
 * Throws `UnauthorizedException` for a missing or unknown kid so callers
 * (passport strategy / Nest guard) surface a clean 401 instead of a 500.
 */
export function selectVerificationKey(rawToken: string, keySet: VerificationKeySet): string {
  const kid = decodeKid(rawToken);
  if (!kid) {
    throw new UnauthorizedException('JWT is missing a key id (kid)');
  }
  const pem = keySet.keys.get(kid);
  if (!pem) {
    throw new UnauthorizedException('JWT was signed with an unknown or rotated-out key');
  }
  return pem;
}
