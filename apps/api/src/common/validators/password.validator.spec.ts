import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_UTF8_BYTES, passwordUtf8Bytes } from '@waitlayer/shared';

import { IsStrongPasswordConstraint, PASSWORD_RULES } from './password.validator';

describe('IsStrongPasswordConstraint', () => {
  const validator = new IsStrongPasswordConstraint();

  it('accepts a strong password within bcrypt UTF-8 limits', () => {
    expect(validator.validate('Correct-Horse-9!')).toBe(true);
  });

  it('rejects values over bcrypt 72-byte input limit even when under 128 characters', () => {
    const password = `Aa1!${'é'.repeat(35)}`; // 74 UTF-8 bytes, 39 characters
    expect(password.length).toBeLessThan(128);
    expect(passwordUtf8Bytes(password)).toBeGreaterThan(PASSWORD_MAX_UTF8_BYTES);
    expect(validator.validate(password)).toBe(false);
    expect(validator.defaultMessage({} as never)).toContain('72 UTF-8 bytes');
    expect(PASSWORD_RULES).toContain('72 UTF-8 bytes');
  });
});
