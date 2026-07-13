import { describe, expect, it } from 'vitest';

import {
  isStrongPassword,
  PASSWORD_MAX_UTF8_BYTES,
  passwordUtf8Bytes,
  passwordValidationError,
} from '@waitlayer/shared';

describe('shared password policy', () => {
  it('accepts a strong password used consistently by clients and API', () => {
    expect(isStrongPassword('Correct-Horse-9!')).toBe(true);
  });

  it.each(['alllowercase1!', 'ALLUPPERCASE1!', 'NoDigitsHere!', 'NoSymbols123']) (
    'rejects a password missing a required class: %s',
    (password) => expect(passwordValidationError(password)).not.toBeNull(),
  );

  it('enforces the bcrypt limit in UTF-8 bytes, not JavaScript characters', () => {
    const password = `Aa1!${'🙂'.repeat(18)}`;
    expect(passwordUtf8Bytes(password)).toBeGreaterThan(PASSWORD_MAX_UTF8_BYTES);
    expect(passwordValidationError(password)).not.toBeNull();
  });
});
