import * as crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  digits?: number;
  stepSeconds?: number;
  algorithm?: string;
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function buildOtpAuthUrl(secret: string, account: string, issuer = 'WaitLayer'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: string, counter: number, digits: number, algorithm: string): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // Write counter as a 64-bit big-endian unsigned integer.
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(algorithm, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

export function generateTotp(secret: string, options: TotpOptions = {}, at = Date.now()): string {
  const digits = options.digits ?? 6;
  const step = options.stepSeconds ?? 30;
  const algorithm = options.algorithm ?? 'SHA1';
  const counter = Math.floor(at / 1000 / step);
  return hotp(secret, counter, digits, algorithm);
}

export function verifyTotp(
  secret: string,
  token: string,
  options: TotpOptions = {},
  at = Date.now(),
  window = 1,
): boolean {
  const digits = options.digits ?? 6;
  const step = options.stepSeconds ?? 30;
  const algorithm = options.algorithm ?? 'SHA1';
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d+$/.test(cleaned) || cleaned.length !== digits) return false;
  const counter = Math.floor(at / 1000 / step);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secret, counter + i, digits, algorithm);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) {
      return true;
    }
  }
  return false;
}
