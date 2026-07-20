import { describe, expect, it, vi } from 'vitest';

import {
  isMigrationValidationError,
  type MigrationStatus,
  type MigrationStatusProvider,
  MigrationValidationError,
  validateMigrations,
} from './migration-validator';

const HEALTHY: MigrationStatus = { pending: [], drift: false };
const PENDING: MigrationStatus = { pending: ['20260720000000_pending'], drift: false };
const DRIFT: MigrationStatus = {
  pending: [],
  drift: true,
  detail: 'Drift detected: CREATE TABLE "drifted"',
};

describe('validateMigrations', () => {
  it('resolves with the status when the database is in sync', async () => {
    const getStatus: MigrationStatusProvider = vi.fn(() => Promise.resolve(HEALTHY));
    const status = await validateMigrations(getStatus);
    expect(status).toBe(HEALTHY);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('throws MigrationValidationError when migrations are pending', async () => {
    const getStatus: MigrationStatusProvider = vi.fn(() => Promise.resolve(PENDING));
    await expect(validateMigrations(getStatus)).rejects.toBeInstanceOf(MigrationValidationError);
    await expect(validateMigrations(getStatus)).rejects.toMatchObject({
      pending: ['20260720000000_pending'],
      drift: false,
    });
  });

  it('throws MigrationValidationError when schema drift is detected', async () => {
    const getStatus: MigrationStatusProvider = vi.fn(() => Promise.resolve(DRIFT));
    await expect(validateMigrations(getStatus)).rejects.toBeInstanceOf(MigrationValidationError);
    await expect(validateMigrations(getStatus)).rejects.toMatchObject({
      pending: [],
      drift: true,
    });
  });

  it('includes the captured detail in the thrown error message', async () => {
    const getStatus: MigrationStatusProvider = vi.fn(() => Promise.resolve(DRIFT));
    await expect(validateMigrations(getStatus)).rejects.toThrow(
      /Drift detected: CREATE TABLE "drifted"/,
    );
  });

  it('isMigrationValidationError narrows the error type', async () => {
    const getStatus: MigrationStatusProvider = vi.fn(() => Promise.resolve(PENDING));
    try {
      await validateMigrations(getStatus);
      throw new Error('should have thrown');
    } catch (err) {
      expect(isMigrationValidationError(err)).toBe(true);
    }
    expect(isMigrationValidationError(new Error('plain'))).toBe(false);
  });
});
