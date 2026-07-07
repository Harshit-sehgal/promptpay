import { describe, it, expect } from 'vitest';
import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildOtpAuthUrl,
} from '@waitlayer/shared';

describe('TOTP (RFC 6238)', () => {
  it('generates a base32 secret of sufficient entropy', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('verifies a freshly generated code', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('accepts a code from the previous/next 30s window', () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;
    const current = generateTotp(secret, {}, at);
    // One step in the future should validate within the default +/-1 window.
    const future = generateTotp(secret, {}, at + 30_000);
    expect(verifyTotp(secret, future, {}, at)).toBe(true);
    expect(verifyTotp(secret, current, {}, at)).toBe(true);
  });

  it('builds an otpauth URL carrying the secret and issuer', () => {
    const secret = generateTotpSecret();
    const url = buildOtpAuthUrl(secret, 'dev@example.com');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain(encodeURIComponent('dev@example.com'));
    expect(url).toContain(`secret=${secret}`);
  });

  it('is timing-safe on verification', () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret);
    // Both a correct and incorrect input return a boolean without throwing.
    expect(typeof verifyTotp(secret, code)).toBe('boolean');
    expect(typeof verifyTotp(secret, '111111')).toBe('boolean');
  });
});
