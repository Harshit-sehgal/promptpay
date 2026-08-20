#!/usr/bin/env node
/**
 * Gate the destructive integration-test database reset.
 *
 * `test:integration` runs `prisma migrate reset --force` against the isolated
 * TEST_DATABASE_URL database before EVERY spec file. That wipes the database
 * — safe in CI (ephemeral runner database) but destructive on a developer
 * machine, where the operator must explicitly consent.
 *
 * Pass when:
 *  - `CI` is truthy (GitHub Actions sets CI=true), or
 *  - `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is set to a truthy value.
 *
 * Otherwise exit 1 with instructions instead of silently wiping whatever
 * TEST_DATABASE_URL points at.
 */
const consent = process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION;
const ci = process.env.CI;
const allowed = ['1', 'true', 'yes'];
const consented = Boolean(
  (consent && allowed.includes(consent.toLowerCase())) || (ci && allowed.includes(ci.toLowerCase())),
);

if (!consented) {
  console.error(
    [
      'Refusing to run the integration reset: `prisma migrate reset --force` would',
      'destructively wipe the database at TEST_DATABASE_URL',
      `  (set to ${process.env.TEST_DATABASE_URL ?? 'the default ateva_test :5433 database'}).`,
      '',
      'To run the full integration suite, prove consent explicitly:',
      '  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm test',
      '',
      'Or run individual spec files against the already-migrated test database',
      '(the reset is skipped and the spec uses the current schema):',
      '  pnpm --filter ateva-api exec vitest run src/integration/<spec>.spec.ts --no-file-parallelism',
      '',
    ].join('\n'),
  );
  process.exit(1);
}