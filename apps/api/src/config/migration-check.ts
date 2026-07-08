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
 * (`<timestamp>_<name>`). Returns an empty array when the migrations
 * directory is not present (e.g. a production image that ships only the
 * generated client) so the check degrades gracefully.
 */
export async function listFolderMigrations(dir: string = MIGRATION_DIR): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => MIGRATION_NAME.test(name)).sort();
}

interface AppliedMigrationRow {
  migration_name: string;
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
  const folderMigrations = await listFolderMigrations(dir);
  if (folderMigrations.length === 0) return [];

  let applied: AppliedMigrationRow[];
  try {
    applied = await prisma.$queryRaw<AppliedMigrationRow[]>`
      SELECT migration_name FROM _prisma_migrations WHERE rolled_back_at IS NULL
    `;
  } catch {
    // The migrations table may not exist yet (fresh DB pre-deploy). Let the
    // deploy step create it; don't fail startup here.
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
