/**
 * Canonical form used for authentication identifiers.
 *
 * Email local parts are technically case-sensitive, but consumer identity
 * providers and the rest of WaitLayer treat an email address as a single
 * account identifier. Normalising at every auth boundary prevents duplicate
 * accounts and login/reset mismatches caused solely by casing or whitespace.
 */
export function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function transformAuthEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeAuthEmail(value) : value;
}
