export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : fallback;
}

export function getErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Check if a Prisma error is a unique constraint violation (P2002).
 * Used to detect duplicate-key insert races across the codebase.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return !!(
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Detect a PostgreSQL/Prisma serialization failure (write-skew or deadlock
 * during a serializable transaction). These are retryable.
 *
 * Prisma surfaces them in two shapes:
 *  - `PrismaClientKnownRequestError` with code `P2034` (serialization) or
 *    `P2038` (transaction timeout / restart).
 *  - A failure inside a raw query (`$executeRaw` / `$queryRaw`) under
 *    SERIALIZABLE isolation surfaces as code `P2010` ("Raw query failed")
 *    carrying the driver's original SQLSTATE `40001` and kind
 *    `TransactionWriteConflict`. Without this branch the retry loop never
 *    fires and the request escapes as a 500 instead of resolving to the
 *    duplicate (409).
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function serializationSqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('meta' in error)) return undefined;
  const meta = asRecord(error.meta);
  if (!meta) return undefined;
  if (typeof meta.originalCode === 'string') return meta.originalCode;
  const dae = asRecord(meta.driverAdapterError);
  if (!dae) return undefined;
  if (typeof dae.originalCode === 'string') return dae.originalCode;
  const cause = asRecord(dae.cause);
  if (cause && typeof cause.originalCode === 'string') return cause.originalCode;
  return undefined;
}

function serializationDriverKind(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('meta' in error)) return undefined;
  const meta = asRecord(error.meta);
  const dae = meta ? asRecord(meta.driverAdapterError) : undefined;
  if (!dae) return undefined;
  if (typeof dae.kind === 'string') return dae.kind;
  const cause = asRecord(dae.cause);
  if (cause && typeof cause.kind === 'string') return cause.kind;
  return undefined;
}

export function isSerializationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'P2034' || code === 'P2038') return true;
  if (code === 'P2010') {
    if (serializationSqlState(error) === '40001') return true;
    if (serializationDriverKind(error) === 'TransactionWriteConflict') return true;
    const msg = getErrorMessage(error);
    if (typeof msg === 'string' && msg.includes('could not serialize')) return true;
  }
  const msg = getErrorMessage(error);
  if (
    typeof msg === 'string' &&
    msg.includes('could not serialize access due to concurrent update')
  )
    return true;
  return false;
}
