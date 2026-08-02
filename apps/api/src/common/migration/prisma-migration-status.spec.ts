import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createPrismaCli,
  getPrismaCliMigrationStatus,
  type PrismaCli,
} from './prisma-migration-status';

const MIGRATIONS = ['20260701000000_initial', '20260801000000_dodo_payments_provider'];
let migrationsDir: string;

beforeAll(async () => {
  migrationsDir = await mkdtemp(path.join(tmpdir(), 'wl-migrations-'));
  await Promise.all(MIGRATIONS.map((name) => mkdir(path.join(migrationsDir, name))));
});

afterAll(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

function makePrisma(applied: string[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(
      applied.map((name) => ({ migration_name: name })),
    ),
  } as never;
}

function makeCli(results: Array<{ code: number; stdout?: string; stderr?: string }>): PrismaCli {
  const queue = [...results];
  return {
    run: vi.fn(() => {
      const next = queue.shift() ?? { code: 0, stdout: '', stderr: '' };
      return Promise.resolve({ code: next.code, stdout: next.stdout ?? '', stderr: next.stderr ?? '' });
    }),
  };
}

describe('getPrismaCliMigrationStatus', () => {
  it('reports no pending migrations and no drift when the DB is in sync', async () => {
    const prisma = makePrisma(MIGRATIONS);
    const status = await getPrismaCliMigrationStatus(prisma, {
      migrationsDir,
      schemaPath: '/tmp/wl-db/schema.prisma',
      cli: makeCli([{ code: 0 }]),
    })();

    expect(status).toEqual({ pending: [], drift: false, detail: undefined });
  });

  it('reports pending migrations but no drift while they are pending', async () => {
    const prisma = makePrisma(['20260701000000_initial']);
    const cli = makeCli([{ code: 2, stdout: 'CREATE TABLE "campaigns"' }]);
    const status = await getPrismaCliMigrationStatus(prisma, {
      migrationsDir,
      schemaPath: '/tmp/wl-db/schema.prisma',
      cli,
    })();

    expect(status.pending).toContain('20260801000000_dodo_payments_provider');
    expect(status.drift).toBe(false);
  });

  it('reports drift once all migrations are applied but the schema differs', async () => {
    const prisma = makePrisma([
      '20260701000000_initial',
      '20260801000000_dodo_payments_provider',
    ]);
    const cli = makeCli([{ code: 2, stdout: 'ALTER TABLE "users"' }]);
    const status = await getPrismaCliMigrationStatus(prisma, {
      migrationsDir,
      schemaPath: '/tmp/wl-db/schema.prisma',
      cli,
    })();

    expect(status.pending).toEqual([]);
    expect(status.drift).toBe(true);
    expect(status.detail).toContain('ALTER TABLE "users"');
  });

  it('fails closed when drift cannot be determined (CLI error)', async () => {
    const prisma = makePrisma([]);
    const cli = makeCli([{ code: 1, stderr: 'Environment variable not found: DATABASE_URL' }]);
    await expect(
      getPrismaCliMigrationStatus(prisma, {
        migrationsDir,
        schemaPath: '/tmp/wl-db/schema.prisma',
        cli,
      })(),
    ).rejects.toThrow(/Could not determine schema drift/);
  });

  it('createPrismaCli throws when neither prisma nor pnpm can be launched', async () => {
    const cli = createPrismaCli('/tmp');
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent-bin';
    try {
      await expect(cli.run(['--version'])).rejects.toThrow(/Could not locate the Prisma CLI/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
