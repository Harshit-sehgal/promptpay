import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './auth/__fixtures__/test-keys';

// BigInt values cannot be serialized by JSON.stringify by default. Every
// monetary column in the schema is stored as BigInt, so without this polyfill
// any response containing an amount would throw at runtime during tests.
// Mirrors the polyfill in apps/api/src/main.ts.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// Ensure RS256 JWT keys are present for any test that boots the full
// Nest application (integration/e2e specs). Unit tests that construct
// AuthService/JwtStrategy directly already import these fixtures.
// These are test-only keys and must NEVER be used in production.
process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY;
process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long';
