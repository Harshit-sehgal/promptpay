import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findPendingMigrations, verifyMigrationsApplied } from './migration-check';

const tempDirs: string[] = [];
let originalNodeEnv: string | undefined;

async function makeMigrationDir(names = ['20240101000000_init']): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waitlayer-migrations-'));
  tempDirs.push(dir);
  await Promise.all(names.map((name) => fs.mkdir(path.join(dir, name))));
  return dir;
}

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('findPendingMigrations (A-012)', () => {
  const folder = ['20240101000000_init', '20240201000000_add_user', '20240301000000_add_ledger'];

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

describe('verifyMigrationsApplied production safety', () => {
  it('fails closed when the migration directory is absent in production', async () => {
    process.env.NODE_ENV = 'production';
    const missing = path.join(os.tmpdir(), `missing-waitlayer-migrations-${Date.now()}`);

    const error = await verifyMigrationsApplied({} as never, missing).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Migration directory is unavailable/);
    expect(error.message).not.toContain(missing);
  });

  it('fails closed when _prisma_migrations cannot be read in production', async () => {
    process.env.NODE_ENV = 'production';
    const dir = await makeMigrationDir();
    const secret = 'postgresql://secret-user:secret-password@private-db.internal/waitlayer';
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error(secret)) };

    const error = await verifyMigrationsApplied(prisma as never, dir).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/Could not read completed migrations/);
    expect(error.message).not.toContain(secret);
  });

  it('counts only finished, non-rolled-back migration rows', async () => {
    process.env.NODE_ENV = 'test';
    const dir = await makeMigrationDir();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ migration_name: '20240101000000_init' }]),
    };

    await expect(verifyMigrationsApplied(prisma as never, dir)).resolves.toEqual([]);
    const sql = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('finished_at IS NOT NULL');
    expect(sql).toContain('rolled_back_at IS NULL');
  });
});
