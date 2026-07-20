import { promises as fs } from 'fs';
import * as path from 'path';

import { PrismaService } from '../config/prisma.service';

/**
 * Pure helper: given the migration directory names and the set of already
 * applied migration names, return the migrations that are present on disk but
 * have not been applied to the database. Kept side-effect free so it can be
 * unit tested without a live database (A-012).
 */
export function findPendingMigrations(
  folderMigrations: string[],
  appliedNames: Set<string>,
): string[] {
  return folderMigrations.filter((name) => !appliedNames.has(name));
}

const MIGRATION_DIR = path.resolve(process.cwd(), 'packages/db/prisma/migrations');
const MIGRATION_NAME = /^\d{14}_[\w-]+$/;

/**
 * List migration directory names that look like Prisma migrations
 * (`<timestamp>_<name>`). Filesystem errors intentionally propagate so the
 * caller can fail closed in production instead of treating a broken image
 * that omitted migrations as "up to date".
 */
export async function listFolderMigrations(dir: string = MIGRATION_DIR): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries.filter((name) => MIGRATION_NAME.test(name)).sort();
}

interface AppliedMigrationRow {
  migration_name: string;
}
/**
 * Read the set of migration names that have been successfully applied to the
 * database (`_prisma_migrations` with `finished_at` set and no rollback).
 * Kept separate from {@link verifyMigrationsApplied} so the drift gate can reuse
 * the exact same query without re-implementing it.
 */
export async function getAppliedMigrationNames(prisma: PrismaService): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<AppliedMigrationRow[]>`
    SELECT migration_name
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  return new Set(rows.map((r) => r.migration_name));
}

/**
 * Compare on-disk migrations against the database's `_prisma_migrations`
 * table. In production an unapplied migration is treated as a fatal startup
 * error; in development it is logged as a warning so local iteration is not
 * blocked. Returns the list of pending migration names (empty when up to date).
 */
export async function verifyMigrationsApplied(
  prisma: PrismaService,
  dir: string = MIGRATION_DIR,
): Promise<string[]> {
  let folderMigrations: string[];
  try {
    folderMigrations = await listFolderMigrations(dir);
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[migration-check] Migration directory is unavailable; the production image must include Prisma migrations',
        { cause: error },
      );
    }
    const detail = `Migration directory is unavailable at ${dir}: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(`[WaitLayer] ${detail}`);
    return [];
  }
  if (folderMigrations.length === 0) {
    const detail = `No Prisma migration directories were found at ${dir}`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[migration-check] ${detail}`);
    }
    console.warn(`[WaitLayer] ${detail}`);
    return [];
  }

  let applied: AppliedMigrationRow[];
  try {
    const names = await getAppliedMigrationNames(prisma);
    applied = Array.from(names).map((migration_name) => ({ migration_name }));
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[migration-check] Could not read completed migrations from _prisma_migrations',
        { cause: error },
      );
    }
    const detail = `Could not read completed migrations from _prisma_migrations: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(`[WaitLayer] ${detail}`);
    return folderMigrations;
  }

  const pending = findPendingMigrations(
    folderMigrations,
    new Set(applied.map((r) => r.migration_name)),
  );

  if (pending.length > 0) {
    const detail = `Unapplied database migrations detected: ${pending.join(', ')}. Run 'prisma migrate deploy' before starting the API.`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[migration-check] ${detail}`);
    }
    console.warn(`[WaitLayer] ${detail}`);
  }
  return pending;
}
