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
 * Detect a PostgreSQL/Prisma serialization failure (write-skew or
 * deadlock during a serializable transaction). Prisma surfaces these
 * as `PrismaClientKnownRequestError` with code `P2034` (serialization)
 * or `P2038` (transaction timeout / restart). Both are retryable.
 */
export function isSerializationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  const code = (error as { code?: string }).code;
  return code === 'P2034' || code === 'P2038';
}
