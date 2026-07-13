const COMMON_PASSWORDS = new Set(
  [
    'password', 'password1', 'password123', '123456', '12345678', '123456789',
    'qwerty', 'abc123', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey',
    'sunshine', 'football', 'secret', 'passw0rd', 'p@ssword', 'qwerty123',
    '1q2w3e4r', 'baseball', 'master', 'hello123', 'freedom', 'shadow',
    'trustno1', 'whatever', 'dragon', 'superman', 'batman', 'changeme',
  ].map((password) => password.toLowerCase()),
);

export const PASSWORD_MIN_CHARACTERS = 8;
export const PASSWORD_MAX_UTF8_BYTES = 72;
export const PASSWORD_RULES =
  'Use 8 or more characters with uppercase, lowercase, a number, and a symbol (72 UTF-8 bytes maximum)';

export function passwordUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function passwordValidationError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_CHARACTERS) return PASSWORD_RULES;
  if (passwordUtf8Bytes(value) > PASSWORD_MAX_UTF8_BYTES) return PASSWORD_RULES;
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return PASSWORD_RULES;
  }
  if (!/[^A-Za-z0-9]/.test(value)) return PASSWORD_RULES;
  if (COMMON_PASSWORDS.has(value.toLowerCase())) return 'Choose a less common password';
  return null;
}

export function isStrongPassword(value: unknown): value is string {
  return passwordValidationError(value) === null;
}
