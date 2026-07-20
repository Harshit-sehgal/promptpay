/**
 * Pure migration-validation contract shared by the API boot path
 * (`apps/api/src/main.ts`) and the standalone CI script
 * (`scripts/validate-migrations.mjs`).
 *
 * This module is intentionally dependency-free (no Prisma, no child_process, no
 * Node built-ins) so it can be unit tested without a live database or the
 * Prisma CLI. The actual "how do we know the DB is in sync?" work lives behind
 * the injectable {@link MigrationStatusProvider}, which the tests mock.
 */

/** Result of checking the database against the migration history. */
export interface MigrationStatus {
  /** Migrations present on disk but not yet applied to the database. */
  pending: string[];
  /** True when the live database schema has drifted from the migration history. */
  drift: boolean;
  /** Optional human-readable detail (e.g. captured Prisma CLI output). */
  detail?: string;
}

/** Supplies the current {@link MigrationStatus}. Injected so it can be mocked. */
export type MigrationStatusProvider = () => Promise<MigrationStatus>;

/** Thrown by {@link validateMigrations} when the database is not in sync. */
export class MigrationValidationError extends Error {
  public readonly pending: string[];
  public readonly drift: boolean;

  constructor(status: MigrationStatus) {
    const reasons: string[] = [];
    if (status.drift) reasons.push('schema drift detected');
    if (status.pending.length > 0) {
      reasons.push(`unapplied migrations: ${status.pending.join(', ')}`);
    }
    const detail = status.detail ? `\n${status.detail.trim()}` : '';
    super(
      `[migration-validation] Database is not in sync with migrations: ${reasons.join('; ')}.${detail}`,
    );
    this.name = 'MigrationValidationError';
    this.pending = status.pending;
    this.drift = status.drift;
  }
}

/** Type guard for {@link MigrationValidationError}. */
export function isMigrationValidationError(value: unknown): value is MigrationValidationError {
  return value instanceof MigrationValidationError;
}

/**
 * Resolve the migration status via the injected provider and fail fast when the
 * database is not in sync (pending migrations or schema drift). Returns the
 * (healthy) status so callers can log a success message. Throws
 * {@link MigrationValidationError} otherwise.
 */
export async function validateMigrations(
  getStatus: MigrationStatusProvider,
): Promise<MigrationStatus> {
  const status = await getStatus();
  if (status.pending.length > 0 || status.drift) {
    throw new MigrationValidationError(status);
  }
  return status;
}
