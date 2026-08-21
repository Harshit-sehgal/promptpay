import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = new URL('./scaffold-production-env.mjs', import.meta.url).pathname;
const configPath = new URL('../packages/config/src/index.ts', import.meta.url).pathname;

function scaffold() {
  return execFileSync(process.execPath, [script], { encoding: 'utf8' });
}

function parse(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

test('emits every var the config schema requires in production', () => {
  const env = parse(scaffold());
  const src = readFileSync(configPath, 'utf8');
  const pattern = /message:\s*[`'"]([^`'"]+)[`'"],\s*\n\s*path:\s*\['([A-Z_]+)'\]/g;
  const required = [
    ...new Set(
      [...src.matchAll(pattern)]
        .filter(([, message]) => /required in (sandbox, staging, and )?production/i.test(message))
        .map(([, , name]) => name),
    ),
  ];
  // Guard the guard — a broken parse would make this vacuous.
  assert.ok(required.includes('PRIVACY_HASH_KEY'), 'schema parse lost PRIVACY_HASH_KEY');
  const missing = required.filter((name) => !env.has(name));
  assert.deepEqual(missing, [], `scaffold omits production-required vars: ${missing.join(', ')}`);
});

test('PEM values are quoted so sourcing the file cannot word-split them', () => {
  const env = parse(scaffold());
  for (const key of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY']) {
    const value = env.get(key);
    assert.ok(value, `${key} missing`);
    // Unquoted, `-----BEGIN PRIVATE KEY-----` word-splits on the first space and
    // the API boots with no signing key. This is the A-097 failure shape.
    assert.ok(value.startsWith('"') && value.endsWith('"'), `${key} must be double-quoted`);
    assert.ok(value.includes('\\n'), `${key} must use literal \\n escapes, not real newlines`);
  }
});

test('operator-supplied values are loud, invalid placeholders', () => {
  const env = parse(scaffold());
  // These have no safe default. The placeholder must be something that FAILS
  // the preflight if it ever survives to a deploy — never a plausible value.
  for (const key of [
    'DATABASE_URL',
    'REDIS_URL',
    'API_BASE_URL',
    'WEB_BASE_URL',
    'ALLOWED_COUNTRIES',
    'ALLOWED_CURRENCIES',
    'OPS_ALERT_EMAIL',
    'RESEND_API_KEY',
    'BFF_TRUST_PROXY_HOPS',
  ]) {
    assert.equal(env.get(key), 'FILL_ME', `${key} should be an unfilled placeholder`);
  }
});

test('security posture is set to the safe side, not left to chance', () => {
  const env = parse(scaffold());
  assert.equal(env.get('NODE_ENV'), 'production');
  assert.equal(env.get('ATEVA_ENVIRONMENT_KIND'), 'production');
  assert.equal(env.get('PAYOUT_REQUIRE_2FA'), 'true');
  assert.equal(env.get('COOKIE_SECURE'), 'true');
  assert.equal(env.get('SWAGGER_ENABLED'), 'false');
  assert.equal(env.get('MOCK_GOOGLE_ENABLED'), '0');
  assert.equal(env.get('ALLOW_MOCK_GOOGLE'), 'false');
  assert.ok(Number(env.get('PAYOUT_DESTINATION_COOLDOWN_HOURS')) >= 24);
});

test('every run generates fresh secrets', () => {
  const a = parse(scaffold());
  const b = parse(scaffold());
  for (const key of ['JWT_PRIVATE_KEY', 'JWT_SECRET', 'PAYOUT_ENCRYPTION_KEY', 'PRIVACY_HASH_KEY']) {
    assert.notEqual(a.get(key), b.get(key), `${key} must not be reused between runs`);
  }
  // The two payout keys must differ from each other — the schema rejects reuse.
  assert.notEqual(a.get('PAYOUT_ENCRYPTION_KEY'), a.get('PAYOUT_HMAC_KEY'));
});
