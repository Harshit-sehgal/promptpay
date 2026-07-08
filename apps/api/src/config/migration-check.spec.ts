import { describe, expect, it } from 'vitest';

import { findPendingMigrations } from './migration-check';

describe('findPendingMigrations (A-012)', () => {
  const folder = [
    '20240101000000_init',
    '20240201000000_add_user',
    '20240301000000_add_ledger',
  ];

  it('returns no pending migrations when all are applied', () => {
    expect(findPendingMigrations(folder, new Set(folder))).toEqual([]);
  });

  it('returns migrations present on disk but not applied', () => {
    const applied = new Set(['20240101000000_init', '20240201000000_add_user']);
    expect(findPendingMigrations(folder, applied)).toEqual(['20240301000000_add_ledger']);
  });

  it('ignores applied names that are not on disk', () => {
    const applied = new Set([...folder, '20249999000000_ghost']);
    expect(findPendingMigrations(folder, applied)).toEqual([]);
  });
});
