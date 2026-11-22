/**
 * A spec that writes to a real Postgres must skip when there is none, exactly
 * like `runtime-config-redis-propagation.spec.ts` skips without `REDIS_URL`.
 *
 * `pnpm --filter @ateva/api test:unit` runs from a fresh checkout with no
 * database, and these suites used to fail there with
 * `password authentication failed for user "ateva"` — a red suite that says
 * nothing about the code. `test:integration` resets and migrates the isolated
 * database first, and it is the only command that sets the opt-in.
 */
export const INTEGRATION = process.env.ATEVA_INTEGRATION === '1';

/** For `describe.skipIf(...)`: true when this suite has no database to use. */
export const noDatabase = !INTEGRATION;

/** The message the skip shows, so nobody reads a skip as a pass by accident. */
export const SKIP_REASON =
  'database spec: run it with `pnpm --filter @ateva/api test:integration` (needs the postgres-test service)';
