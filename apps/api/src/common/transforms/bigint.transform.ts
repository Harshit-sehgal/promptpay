import type { TransformFnParams } from 'class-transformer';

/**
 * Convert canonical integer input to bigint without throwing inside
 * class-transformer. Invalid values are returned unchanged so `@IsBigInt()`
 * produces a normal validation error (HTTP 400) instead of the global error
 * filter seeing a native SyntaxError and returning 500.
 */
export function toBigIntOrOriginal({ value }: TransformFnParams): unknown {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return value;
}
