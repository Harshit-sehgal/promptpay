import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../../../packages/db/prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../../packages/db/prisma/migrations/20260716010000_payout_account_initiation_lease/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('payout-account provider-initiation fence schema', () => {
  it('maps the durable payout fence to the deployed snake-case column', () => {
    expect(schema).toMatch(/initiationPayoutId\s+String\?\s+@map\("initiation_payout_id"\)/);
  });

  it('adds the payout fence and forbids frozen accounts from holding it', () => {
    expect(migration).toContain('ADD COLUMN "initiation_payout_id" TEXT');
    expect(migration).toContain('pt."providerTxId" = \'initiate_pending_\' || pr."id"');
    expect(migration).toContain('Multiple ambiguous payout initiations exist');
    expect(migration).toContain('SET "initiation_payout_id" = candidates."payoutId"');
    expect(migration).toContain('"chk_payout_accounts_frozen_without_initiation_fence"');
    expect(migration).toContain('CHECK (NOT "is_frozen" OR "initiation_payout_id" IS NULL)');
    expect(migration).not.toContain('expires');
  });
});
