import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// ── Schema ↔ generator completeness ────────────────────────────────────────
// `PRIVACY_HASH_KEY` was production-required by the config schema, was only a
// COMMENTED-OUT line in `.env.example`, and this generator never emitted it —
// so an operator following the documented bootstrap produced a secrets set the
// API then refused to boot with. Every test above validated the keys that were
// present; none asserted the set was COMPLETE, which is exactly how it hid.
//
// This derives the required list from the schema itself, so adding a new
// production requirement forces a decision here instead of silently omitting
// it: either the generator emits it, or it is declared operator-supplied.
const OPERATOR_SUPPLIED = new Set([
  // Infrastructure and launch policy — a generator cannot invent these.
  'REDIS_URL',
  'ALLOWED_COUNTRIES',
  'ALLOWED_CURRENCIES',
  'OPS_ALERT_EMAIL',
  'BFF_TRUST_PROXY_HOPS',
]);

function schemaRequiredVars() {
  const configPath = new URL('../packages/config/src/index.ts', import.meta.url).pathname;
  const src = readFileSync(configPath, 'utf8');
  const pattern = /message:\s*[`'"]([^`'"]+)[`'"],\s*\n\s*path:\s*\['([A-Z_]+)'\]/g;
  return [...new Set(
    [...src.matchAll(pattern)]
      .filter(([, message]) => /required in (sandbox, staging, and )?production/i.test(message))
      .map(([, , name]) => name),
  )].sort();
}

test('every schema-required production var is generated or declared operator-supplied', () => {
  const generated = new Set(Object.keys(generate()));
  const required = schemaRequiredVars();
  assert.ok(required.length >= 5, `expected to parse several required vars, got ${required.length}`);
  // Guard the guard: if the schema parse silently stopped matching, this
  // assertion would pass vacuously.
  assert.ok(required.includes('PRIVACY_HASH_KEY'), 'schema parse lost PRIVACY_HASH_KEY');

  const unaccounted = required.filter((n) => !generated.has(n) && !OPERATOR_SUPPLIED.has(n));
  assert.deepEqual(
    unaccounted,
    [],
    `Production-required but neither generated nor declared operator-supplied: ${unaccounted.join(', ')}. ` +
      'Emit it from generate-secrets.mjs, or add it to OPERATOR_SUPPLIED with a reason.',
  );
});
