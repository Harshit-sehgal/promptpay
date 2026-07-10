import { describe, expect, it } from 'vitest';

import { signPayload } from './signing';

// The CLI re-implements HMAC request signing locally in `signing.ts` as a
// deliberate duplicate of `packages/shared/src/signing.ts`. The CLI package does
// NOT depend on `@waitlayer/shared` (intentional — see apps/cli/package.json),
// so we cannot import the shared signer here. Instead we lock the CLI signer to
// an independently computed, known-good HMAC-SHA256 value for a fixed payload +
// secret. If the two implementations ever diverge, this assertion fails.
//
// Known-good value computed as:
//   HMAC-SHA256(
//     "test-secret",
//     JSON.stringify({ a:1, b:2, list:[3,1,2], nested:{ y:2, z:1 } })  // keys sorted, no whitespace
//   ) = c8aa28cf...
const KNOWN_GOOD_SIGNATURE = 'c8aa28cf78a023e93cd705f4035404f3a99b93f44806ffeabdf790478bb67059';

describe('signPayload HMAC parity with shared signer', () => {
  const secret = 'test-secret';
  const payload = { b: 2, a: 1, nested: { z: 1, y: 2 }, list: [3, 1, 2] };

  it('matches a known-good HMAC-SHA256 over canonical (key-sorted) JSON', () => {
    expect(signPayload(payload, secret)).toBe(KNOWN_GOOD_SIGNATURE);
  });

  it('is order-independent (canonicalization sorts object keys recursively)', () => {
    const reordered = { a: 1, b: 2, list: [3, 1, 2], nested: { y: 2, z: 1 } };
    expect(signPayload(reordered, secret)).toBe(KNOWN_GOOD_SIGNATURE);
  });

  it('differs when the secret changes', () => {
    expect(signPayload(payload, 'other-secret')).not.toBe(KNOWN_GOOD_SIGNATURE);
  });
});
