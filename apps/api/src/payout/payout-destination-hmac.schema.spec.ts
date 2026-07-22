import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../../packages/db/prisma/migrations/20260722020000_allow_shared_payout_destination_hmac/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('shared payout-destination fraud lookup schema', () => {
  it('keeps destination HMAC searchable without globally rejecting shared destinations', () => {
    expect(schema).toMatch(/destinationHmac\s+String\?\s+@map\("destination_hmac"\)/);
    expect(schema).toMatch(
      /@@index\(\[destinationHmac\], map: "payout_accounts_destination_hmac_idx"\)/,
    );
    expect(migration).toContain('DROP INDEX IF EXISTS "payout_accounts_destination_hmac_key"');
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "payout_accounts_destination_hmac_idx"',
    );
  });
});
