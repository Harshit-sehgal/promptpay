import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

import {
  findPendingMigrations,
  getAppliedMigrationNames,
  listFolderMigrations,
} from '../../config/migration-check';
import { PrismaService } from '../../config/prisma.service';
import type { MigrationStatusProvider } from './migration-validator';

/** `prisma migrate diff --exit-code`: 0 = empty, 1 = error, 2 = not empty. */
const PRISMA_DIFF_NOT_EMPTY = 2;

/** Runs the Prisma CLI and returns its exit code + captured output. */
export interface PrismaCli {
  run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface GetStatusOptions {
  /** Absolute or cwd-relative path to `prisma/schema.prisma`. */
  schemaPath?: string;
  /** Absolute or cwd-relative path to the `prisma/migrations` directory. */
  migrationsDir?: string;
  /** Override the Prisma CLI runner (used in tests / non-standard environments). */
  cli?: PrismaCli;
}

/**
 * Walk up from the current working directory to locate `packages/db`, which is
 * where `prisma.config.ts` and the migrations live. This is cwd-independent so
 * the same code works whether the API is booted from the repo root (Docker,
 * `WORKDIR /app`), from `apps/api`, or from a vitest worker subdirectory.
 */
export function resolveDbPackageDir(): string {
  let dir = process.cwd();
  for (;;) {
    const marker = path.join(dir, 'packages', 'db', 'prisma', 'schema.prisma');
    if (existsSync(marker)) return path.join(dir, 'packages', 'db');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall through to the historical cwd-relative resolution.
  return path.resolve(process.cwd(), 'packages', 'db');
}

interface ExecFileError extends NodeJS.ErrnoException {
  stdout?: string;
  stderr?: string;
}

function execFileAsync(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Could not even launch the binary (e.g. missing from PATH): let the caller
      // try the next strategy.
      if (error && (error as ExecFileError).code === 'ENOENT') {
        reject(error);
        return;
      }
      let code = 0;
      if (error) {
        const ec = (error as ExecFileError).code;
        code = typeof ec === 'number' ? ec : 1;
      }
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

/**
 * Build a Prisma CLI runner. Tries `prisma` directly (global install in the
 * Docker runtime image, on PATH) and then `pnpm --filter @waitlayer/db exec
 * prisma` (local dev + CI). The first strategy that launches wins; non-zero
 * exits are surfaced as `{ code }` rather than thrown, so callers decide how to
 * react. `cwd` is set to the db package directory so Prisma finds
 * `prisma.config.ts` regardless of where the host process was started.
 */
export function createPrismaCli(cwd: string = resolveDbPackageDir()): PrismaCli {
  const strategies: Array<() => { cmd: string; args: string[] }> = [
    () => ({ cmd: 'prisma', args: [] }),
    () => ({ cmd: 'pnpm', args: ['--filter', '@waitlayer/db', 'exec', 'prisma'] }),
  ];

  return {
    async run(args: string[]) {
      let lastErr: unknown;
      for (const make of strategies) {
        const { cmd, args: prefix } = make();
        try {
          return await execFileAsync(cmd, [...prefix, ...args], cwd);
        } catch (err) {
          lastErr = err;
          // ENOENT => binary not found; try the next strategy.
        }
      }
      throw new Error(
        '[migration-validation] Could not locate the Prisma CLI (tried `prisma` on PATH and `pnpm --filter @waitlayer/db exec prisma`).',
        { cause: lastErr },
      );
    },
  };
}

async function detectDrift(
  cli: PrismaCli,
  schemaPath: string,
): Promise<{ drift: boolean; detail?: string }> {
  const { code, stdout, stderr } = await cli.run([
    'migrate',
    'diff',
    '--exit-code',
    '--from-config-datasource',
    '--to-schema',
    schemaPath,
  ]);
  if (code === 0) return { drift: false };
  if (code === PRISMA_DIFF_NOT_EMPTY) {
    const detail = `${stdout}${stderr}`.trim() || 'schema differs from the migration history';
    return { drift: true, detail };
  }
  // code === 1 (or other): the CLI could not determine drift. Fail closed so we
  // never boot (or green-light CI) against an unverifiable database.
  const detail = `${stdout}${stderr}`.trim() || 'prisma migrate diff failed';
  throw new Error(`[migration-validation] Could not determine schema drift: ${detail}`);
}

/**
 * Build a {@link MigrationStatusProvider} for the running API. Pending
 * migrations are detected deterministically via `_prisma_migrations`; schema
 * drift is detected by diffing the live database against the datamodel.
 *
 * A non-empty `migrate diff` while migrations are pending is expected (the live
 * database simply has not reached the datamodel yet), so drift is only reported
 * when there are no pending migrations.
 */
export function getPrismaCliMigrationStatus(
  prisma: PrismaService,
  options: GetStatusOptions = {},
): MigrationStatusProvider {
  const dbDir = resolveDbPackageDir();
  const schemaPath = options.schemaPath ?? path.join(dbDir, 'prisma', 'schema.prisma');
  const migrationsDir = options.migrationsDir ?? path.join(dbDir, 'prisma', 'migrations');
  const cli = options.cli ?? createPrismaCli(dbDir);

  return async () => {
    const folderMigrations = await listFolderMigrations(migrationsDir);
    const applied = await getAppliedMigrationNames(prisma);
    const pending = findPendingMigrations(folderMigrations, applied);

    const { drift, detail } = await detectDrift(cli, schemaPath);
    return {
      pending,
      drift: drift && pending.length === 0,
      detail,
    };
  };
}
