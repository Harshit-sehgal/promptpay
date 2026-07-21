// Load .env before any other test code runs so both tests that boot the full
// Nest app (via ConfigModule→dotenv) AND tests that directly construct
// PrismaService / ConfigService bypassing the app module see the same
// environment. This mirrors production: main.ts imports ./instrument which
// does the same `import 'dotenv/config'`. Without this, direct-PrismaService
// specs that don't boot AppModule (e.g. audit-rollback.spec.ts) fail when run
// in isolation or first in file order because DATABASE_URL is not set.
import 'dotenv/config';

import { TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY } from './auth/__fixtures__/test-keys';

// Integration tests mutate and truncate their database. Never inherit the
// development DATABASE_URL from .env: use the isolated postgres-test service
// by default, with an explicit TEST_DATABASE_URL escape hatch for CI.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://waitlayer:waitlayer-test@localhost:5433/waitlayer_test?schema=public';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

// Tests must never run under NODE_ENV=production: the config validator's
// production rules (PRIVACY_HASH_KEY, Resend credentials, HTTPS origins) and
// the privacy-hash / Stack provider production guards would reject the dev
// environment and crash suites that boot the full Nest app. Force a test
// environment so the suite is deterministic regardless of the parent shell
// (which may export NODE_ENV=production from a prior `next build`).
process.env.NODE_ENV = 'test';

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
// Never inherit short-lived credential settings from a developer shell or a
// deployment smoke environment. Individual auth tests can still construct an
// AuthService with an explicit TTL when they need to cover expiry behaviour.
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
