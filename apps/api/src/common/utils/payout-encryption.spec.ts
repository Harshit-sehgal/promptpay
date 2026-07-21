import { beforeEach, describe, expect, it } from 'vitest';

import {
  decryptPayoutDestination,
  encryptPayoutDestination,
  hmacPayoutDestination,
  isEncryptedDestination,
  maskPayoutDestination,
  safeDisplayDestination,
  tryDecryptPayoutDestination,
} from './payout-encryption';

// Set a stable test key (must be set before imports settle if the module had
// side effects, but the utility reads process.env lazily, so we set it here).
const TEST_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
).toString('base64');

beforeEach(() => {
  process.env.PAYOUT_ENCRYPTION_KEY = TEST_KEY;
});

describe('encryptPayoutDestination / decryptPayoutDestination', () => {
  it('round-trips an email destination', () => {
    const dest = 'dev@example.com';
    const encrypted = encryptPayoutDestination(dest);
    expect(encrypted).not.toBe(dest);
    expect(isEncryptedDestination(encrypted)).toBe(true);
    expect(decryptPayoutDestination(encrypted)).toBe(dest);
  });

  it('round-trips a Stripe account id', () => {
    const dest = 'acct_1AbCdEfGhIjKlMnOpQrStUv';
    const encrypted = encryptPayoutDestination(dest);
    expect(isEncryptedDestination(encrypted)).toBe(true);
    expect(decryptPayoutDestination(encrypted)).toBe(dest);
  });

  it('round-trips a manual destination', () => {
    const dest = 'manual-dest-wallet-001';
    const encrypted = encryptPayoutDestination(dest);
    expect(decryptPayoutDestination(encrypted)).toBe(dest);
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const dest = 'same@email.com';
    const a = encryptPayoutDestination(dest);
    const b = encryptPayoutDestination(dest);
    expect(a).not.toBe(b);
    // Both must still decrypt correctly
    expect(decryptPayoutDestination(a)).toBe(dest);
    expect(decryptPayoutDestination(b)).toBe(dest);
  });

  it('rejects an unsupported key version', () => {
    expect(() => decryptPayoutDestination('v0:base64data')).toThrow('Unsupported');
  });

  it('rejects tampered ciphertext', () => {
    const dest = 'dev@example.com';
    const encrypted = encryptPayoutDestination(dest);
    const bits = encrypted.split(':');
    // Corrupt the base64 payload
    const corrupted = bits[0] + ':' + bits[1].slice(0, -4) + 'AAAA';
    expect(() => decryptPayoutDestination(corrupted)).toThrow();
  });
});

describe('hmacPayoutDestination', () => {
  it('produces deterministic output for the same input', () => {
    const dest = 'dev@example.com';
    const a = hmacPayoutDestination(dest);
    const b = hmacPayoutDestination(dest);
    expect(a).toBe(b);
  });

  it('normalizes case and whitespace', () => {
    expect(hmacPayoutDestination('Dev@Example.COM')).toBe(
      hmacPayoutDestination('  dev@example.com  '),
    );
  });

  it('produces different values for different destinations', () => {
    expect(hmacPayoutDestination('a@b.com')).not.toBe(hmacPayoutDestination('b@c.com'));
  });
});

describe('maskPayoutDestination', () => {
  it('masks email addresses', () => {
    expect(maskPayoutDestination('dev@example.com')).toBe('dev***@example.com');
  });

  it('masks short email prefixes', () => {
    expect(maskPayoutDestination('ab@test.com')).toBe('ab***@test.com');
  });

  it('masks email with subdomain', () => {
    expect(maskPayoutDestination('developer@sub.example.com')).toBe('dev***@sub.example.com');
  });

  it('masks Stripe account ids', () => {
    expect(maskPayoutDestination('acct_1AbCdEfGhIjKlMnOpQ')).toBe('acct_***nOpQ');
  });

  it('masks long manual destinations', () => {
    expect(maskPayoutDestination('manual-dest-wallet-001')).toBe('manual***-001');
  });

  it('masks short strings', () => {
    expect(maskPayoutDestination('abc123')).toBe('abc***');
  });

  it('returns empty for empty input', () => {
    expect(maskPayoutDestination('')).toBe('');
    expect(maskPayoutDestination('   ')).toBe('');
  });
});

describe('safeDisplayDestination', () => {
  it('decrypts and masks an encrypted destination', () => {
    const encrypted = encryptPayoutDestination('dev@example.com');
    expect(safeDisplayDestination(encrypted)).toBe('dev***@example.com');
  });

  it('masks a legacy plaintext destination directly', () => {
    expect(safeDisplayDestination('dev@example.com')).toBe('dev***@example.com');
  });

  it('returns [encrypted] when decryption fails (tampered data)', () => {
    expect(safeDisplayDestination('v1:AAAAinvalidbase64')).toBe('[encrypted]');
  });

  it('returns empty for null/undefined', () => {
    expect(safeDisplayDestination(null)).toBe('');
    expect(safeDisplayDestination(undefined)).toBe('');
  });
});

describe('tryDecryptPayoutDestination', () => {
  it('decrypts an encrypted destination', () => {
    const encrypted = encryptPayoutDestination('stripe@connect.com');
    expect(tryDecryptPayoutDestination(encrypted)).toBe('stripe@connect.com');
  });

  it('passes through legacy plaintext destinations unchanged', () => {
    expect(tryDecryptPayoutDestination('acct_legacy123')).toBe('acct_legacy123');
  });
});
