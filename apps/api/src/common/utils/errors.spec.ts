import { describe, expect, it } from 'vitest';

import { isSerializationError } from './errors';

/**
 * Reconstruct the error `@prisma/adapter-pg` throws for SQLSTATE 40001 inside an
 * interactive transaction.
 *
 * Provenance — `@prisma/driver-adapter-utils` `DriverAdapterError`:
 *   `name = 'DriverAdapterError'`, `cause = payload`, and `message` falls back
 *   to `payload.kind` when the payload carries no `message`. The pg adapter maps
 *   `40001` to `{ kind: 'TransactionWriteConflict' }`.
 *
 * Critically it carries NO `code`, which is why every `P20xx`-keyed branch
 * missed it and a serialization abort escaped as a 500 instead of retrying.
 */
function driverAdapterWriteConflict(): Error {
  const error = new Error('TransactionWriteConflict');
  error.name = 'DriverAdapterError';
  (error as Error & { cause?: unknown }).cause = { kind: 'TransactionWriteConflict' };
  return error;
}

describe('isSerializationError', () => {
  it('detects the raw pg driver-adapter write conflict (no Prisma error code)', () => {
    const error = driverAdapterWriteConflict();
    // Guard: if this ever gains a code, the regression that motivated the fix
    // is gone and this test is no longer testing the real hazard.
    expect((error as Error & { code?: unknown }).code).toBeUndefined();
    expect(isSerializationError(error)).toBe(true);
  });

  it('detects a DriverAdapterError whose kind is only on the message', () => {
    const error = new Error('TransactionWriteConflict');
    error.name = 'DriverAdapterError';
    expect(isSerializationError(error)).toBe(true);
  });

  it.each(['P2034', 'P2038'])('detects Prisma serialization code %s', (code) => {
    expect(isSerializationError(Object.assign(new Error('conflict'), { code }))).toBe(true);
  });

  it('detects a raw-query serialization failure carrying SQLSTATE 40001', () => {
    const error = Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: { driverAdapterError: { kind: 'TransactionWriteConflict' } },
    });
    expect(isSerializationError(error)).toBe(true);
  });

  it('detects the raw Postgres serialization message', () => {
    expect(
      isSerializationError(new Error('could not serialize access due to concurrent update')),
    ).toBe(true);
  });

  // The retry loops that consume this must not swallow real failures: a
  // constraint violation or a missing row is deterministic, and retrying it
  // would just spin and then report the same error later.
  it('does not classify unrelated database errors as retryable', () => {
    const cases: unknown[] = [
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
      Object.assign(new Error('record not found'), { code: 'P2025' }),
      Object.assign(new Error('table does not exist'), {
        code: 'P2010',
        meta: { driverAdapterError: { kind: 'TableDoesNotExist' } },
      }),
      new Error('connection refused'),
      // Same driver-adapter envelope, different (non-retryable) kind.
      Object.assign(Object.assign(new Error('LengthMismatch'), { name: 'DriverAdapterError' }), {
        cause: { kind: 'LengthMismatch' },
      }),
      null,
      undefined,
      'TransactionWriteConflict',
    ];
    for (const value of cases) {
      expect(isSerializationError(value)).toBe(false);
    }
  });
});
