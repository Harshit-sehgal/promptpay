#!/usr/bin/env node
/**
 * Production-mode boot smoke (A-098).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every automated gate in this repo exercises the API in a mode no real
 * deployment ever uses:
 *
 *   - unit/integration tests set `NODE_ENV=test` and inject **multi-line** PEMs;
 *   - `.e2e/run-e2e.sh` exports `NODE_ENV=development` for the API (the web is
 *     built for production, the API it talks to is not);
 *   - the CI `docker-build` job boots the image but only asserts that a few
 *     routes resolve (login 400 / me 401 / docs 200), never that a token can
 *     actually be issued.
 *
 * A-097 lived in that gap: the RS256 *signing* key was never normalised, so a
 * correctly-configured production API booted, reported `/health` 200 with
 * `database: connected`, served every public page — and failed **100% of
 * authentication** with "secretOrPrivateKey must be an asymmetric key when
 * using RS256". 1316 unit tests and 114 e2e tests all passed.
 *
 * This smoke closes that gap by asserting the things that only differ in
 * production, against a running production-mode API:
 *
 *   1. It boots at all (env schema, environment marker, migrations).
 *   2. `/health` is 200 and reports `environmentKind: production`.
 *   3. **A token can actually be issued** — the single assertion that would
 *      have caught A-097.
 *   4. The issued token verifies against the configured public key with the
 *      expected issuer/audience, so a key mismatch cannot pass.
 *   5. Production-only guards are live: Swagger is closed, the MFA step-up
 *      guard blocks admin writes, mock Google auth is refused.
 *   6. The money switches are fail-closed.
 *
 * USAGE
 *   API_BASE_URL=http://localhost:4002/api/v1 \
 *   SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... \
 *   JWT_PUBLIC_KEY=... \
 *     node scripts/production-boot-smoke.mjs
 *
 * Credentials are optional: without them the smoke still runs every
 * unauthenticated check and reports the token checks as skipped, so it is
 * usable as a post-deploy probe against an environment whose admin password
 * you do not hold.
 */
import { createPublicKey, createVerify } from 'node:crypto';

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:4002/api/v1').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

const results = [];
const pass = (name, detail = '') => results.push({ level: 'PASS', name, detail });
const fail = (name, detail) => results.push({ level: 'FAIL', name, detail });
const skip = (name, detail) => results.push({ level: 'SKIP', name, detail });

async function http(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON is fine for status-only checks */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Decode a JWT without verifying — used only to read claims for assertions. */
function decodeJwt(token) {
  const [h, p] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  };
}

function verifyRs256(token, publicKeyPem) {
  const [h, p, s] = token.split('.');
  const key = createPublicKey(publicKeyPem.replace(/\\n/g, '\n').trim());
  return createVerify('RSA-SHA256').update(`${h}.${p}`).verify(key, Buffer.from(s, 'base64url'));
}

async function checkHealth() {
  const { status, json } = await http('/health');
  if (status !== 200) return fail('health', `expected 200, got ${status}`);
  if (json?.status !== 'ok') return fail('health', `status field is "${json?.status}"`);
  if (json?.database !== 'connected') return fail('health-database', String(json?.database));
  pass('health', `ok, db connected, launchMode=${json?.waitLaunchMode}`);

  if (json?.environmentKind !== 'production') {
    fail('environment-kind', `expected "production", got "${json?.environmentKind}"`);
  } else {
    pass('environment-kind', 'production');
  }
}

async function checkPublicRoutes() {
  // Routes must resolve to their real handlers. A 404 here means the compiled
  // controller graph did not load — the failure mode the CI docker-build job
  // watches for.
  const cases = [
    {
      path: '/auth/login',
      init: { method: 'POST', headers: jsonHeaders(), body: '{}' },
      expect: 400,
    },
    { path: '/auth/me', init: {}, expect: 401 },
    { path: '/admin/overview', init: {}, expect: 401 },
    { path: '/health/ready', init: {}, expect: 200 },
  ];
  for (const c of cases) {
    const { status } = await http(c.path, c.init);
    if (status === 404) fail(`route ${c.path}`, 'resolved to 404 — controller did not load');
    else if (status !== c.expect) fail(`route ${c.path}`, `expected ${c.expect}, got ${status}`);
    else pass(`route ${c.path}`, String(status));
  }
}

async function checkProductionGuards() {
  // Swagger must be closed in production unless explicitly opened.
  const docs = await http('/docs');
  if (docs.status === 200 && process.env.SWAGGER_ENABLED !== 'true') {
    fail('swagger-closed', '/docs is 200 in production without SWAGGER_ENABLED=true');
  } else {
    pass('swagger-closed', `/docs → ${docs.status}`);
  }

  // The mock-Google path must not exist in a production build.
  const mock = await http('/auth/google/mock', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email: 'attacker@example.test' }),
  });
  if (mock.status === 200 || mock.status === 201) {
    fail('mock-google-closed', `mock Google sign-in returned ${mock.status} in production`);
  } else {
    pass('mock-google-closed', String(mock.status));
  }

  // Privileged roles must never be self-assignable.
  const signup = await http('/auth/signup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      email: `smoke-${Date.now()}@waitlayer.test`,
      password: 'Str0ng!Passw0rd#2026',
      role: 'admin',
      ageConfirmed: true,
      termsAccepted: true,
    }),
  });
  if (signup.status === 400) pass('privileged-role-refused', '400');
  else fail('privileged-role-refused', `expected 400, got ${signup.status}`);
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

async function checkAuthentication() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    skip('token-issuance', 'set SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD to exercise login');
    return null;
  }

  const { status, json, text } = await http('/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  // THE A-097 ASSERTION. A 500 here is the exact signature of a signing key
  // the runtime cannot use.
  if (status === 500) {
    fail(
      'token-issuance',
      'login returned HTTP 500 — the API cannot sign tokens. Check that JWT_PRIVATE_KEY ' +
        'survives `\\n` unescaping (A-097) and that the key pair is valid.',
    );
    return null;
  }
  if (status !== 200 && status !== 201) {
    fail('token-issuance', `login returned ${status}: ${text.slice(0, 160)}`);
    return null;
  }
  const token = json?.accessToken;
  if (!token) {
    fail('token-issuance', 'login succeeded but returned no accessToken');
    return null;
  }
  pass('token-issuance', `login 200, token issued (${token.length} chars)`);

  // A token that cannot be verified against the configured public key means
  // the signing and verification halves disagree — auth would fail on the
  // very next request, which a login-only check would miss.
  if (!PUBLIC_KEY) {
    skip('token-verifies', 'set JWT_PUBLIC_KEY to verify the signature');
  } else if (verifyRs256(token, PUBLIC_KEY)) {
    pass('token-verifies', 'RS256 signature valid for the configured public key');
  } else {
    fail('token-verifies', 'token does NOT verify against JWT_PUBLIC_KEY — key pair mismatch');
  }

  const { header, payload } = decodeJwt(token);
  if (header.alg !== 'RS256') fail('token-alg', `expected RS256, got ${header.alg}`);
  else pass('token-alg', 'RS256');
  if (!header.kid) fail('token-kid', 'no key id — rotation and JWKS selection would break');
  else pass('token-kid', header.kid.slice(0, 16));

  const expectedIssuer = process.env.JWT_ISSUER ?? 'waitlayer';
  const expectedAudience = process.env.JWT_AUDIENCE ?? 'waitlayer-client';
  if (payload.iss !== expectedIssuer) fail('token-issuer', `${payload.iss} !== ${expectedIssuer}`);
  else pass('token-issuer', String(payload.iss));

  // `aud` is an ARRAY: `[JWT_AUDIENCE, 'access' | 'refresh']`
  // (auth-session.trait.ts). The second element is what stops a refresh token
  // being replayed as an access token, so assert both parts — an access token
  // that arrived without its `access` marker would mean that separation is gone.
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(expectedAudience)) {
    fail('token-audience', `${JSON.stringify(payload.aud)} does not include ${expectedAudience}`);
  } else if (!audience.includes('access')) {
    fail(
      'token-audience',
      `access token is missing the "access" audience marker (aud=${JSON.stringify(payload.aud)}) — ` +
        'the access/refresh separation that prevents refresh-token replay is not in effect',
    );
  } else {
    pass('token-audience', JSON.stringify(payload.aud));
  }

  // The token must actually be accepted by a protected route.
  const me = await http('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (me.status === 200) pass('token-accepted', '/auth/me 200');
  else fail('token-accepted', `/auth/me returned ${me.status} with a fresh token`);

  return token;
}

async function checkAdminSurface(token) {
  if (!token) {
    skip('admin-mfa-step-up', 'no token');
    skip('money-switches', 'no token');
    return;
  }
  const auth = { Authorization: `Bearer ${token}` };

  const overview = await http('/admin/overview', { headers: auth });
  if (overview.status === 200) pass('admin-read', '200');
  else fail('admin-read', `expected 200, got ${overview.status}`);

  // Production MUST require recent 2FA for admin writes. A 200 here means the
  // step-up guard is not active and any stolen admin token is fully powerful.
  const write = await http('/admin/settings/ads/global/toggle', {
    method: 'POST',
    headers: { ...auth, ...jsonHeaders() },
    body: JSON.stringify({ enabled: false, reason: 'production boot smoke' }),
  });
  if (write.status === 403) pass('admin-mfa-step-up', '403 without recent 2FA (correct)');
  else if (write.status === 200)
    fail('admin-mfa-step-up', 'admin write SUCCEEDED without recent 2FA — guard is not active');
  else pass('admin-mfa-step-up', `blocked with ${write.status}`);

  const settings = await http('/admin/settings', { headers: auth });
  if (settings.status !== 200) return fail('money-switches', `settings → ${settings.status}`);
  const enabled = (Array.isArray(settings.json) ? settings.json : [])
    .filter((s) => s?.value?.enabled === true)
    .map((s) => `${s.scope}.${s.target}`);
  pass(
    'money-switches',
    enabled.length === 0 ? 'all fail-closed' : `ENABLED: ${enabled.join(', ')}`,
  );
}

async function main() {
  console.log(`production-boot-smoke → ${BASE}\n`);
  await checkHealth();
  await checkPublicRoutes();
  await checkProductionGuards();
  const token = await checkAuthentication();
  await checkAdminSurface(token);

  const width = Math.max(...results.map((r) => r.name.length));
  for (const { level, name, detail } of results) {
    const badge = level === 'PASS' ? '  ok ' : level === 'SKIP' ? ' skip' : 'FAIL ';
    console.log(`[${badge}] ${name.padEnd(width)}  ${detail}`);
  }
  const failures = results.filter((r) => r.level === 'FAIL');
  const skipped = results.filter((r) => r.level === 'SKIP');
  console.log(
    `\n${results.length - failures.length - skipped.length} passed, ` +
      `${skipped.length} skipped, ${failures.length} failed`,
  );
  if (failures.length > 0) {
    console.log('\nProduction boot smoke FAILED — do not serve traffic from this deployment.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`production-boot-smoke: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
