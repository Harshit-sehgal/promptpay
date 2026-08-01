import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = new URL('./generate-secrets.mjs', import.meta.url).pathname;

function generate() {
  const stdout = execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

test('generates a valid RS256 key pair', () => {
  const s = generate();
  const pub = createPublicKey(s.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'));
  const priv = createPrivateKey(s.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'));
  assert.equal(pub.asymmetricKeyType, 'rsa');
  assert.equal(priv.asymmetricKeyType, 'rsa');
});

test('JWT_SECRET is long enough and free of placeholders', () => {
  const s = generate();
  assert.ok(s.JWT_SECRET.length >= 32);
  assert.ok(!s.JWT_SECRET.includes('change-me'));
  assert.ok(!s.JWT_SECRET.includes('replace-with'));
  assert.ok(!s.JWT_SECRET.startsWith('dev-jwt-secret'));
});

test('TOTP and email secrets meet the minimum lengths', () => {
  const s = generate();
  assert.ok(s.TOTP_SECRET_ENCRYPTION_KEY.length >= 32);
  assert.ok(s.EMAIL_QUEUE_SECRET.length >= 32);
});

test('payout keys are canonical base64-encoded 32-byte keys', () => {
  const s = generate();
  for (const key of ['PAYOUT_ENCRYPTION_KEY', 'PAYOUT_HMAC_KEY']) {
    const value = s[key];
    assert.match(value, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(value.length % 4, 0);
    assert.equal(Buffer.from(value, 'base64').length, 32);
    assert.equal(Buffer.from(value, 'base64').toString('base64'), value);
  }
});

test('--check mode exits successfully', () => {
  const stdout = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.match(stdout, /OK:/);
});
