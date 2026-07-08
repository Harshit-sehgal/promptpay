/* Live end-to-end test against the running API (localhost:4000).
 *
 * Exercises real guards (no overrides), the hardened per-device extension
 * flow (HMAC-signed events), 2FA/consent, advertiser campaign creation +
 * admin approval, payout method + request, and the admin + health metrics
 * endpoints. Minted email-verification tokens use the known dev JWT secret.
 *
 * The extension journey signs each event with the device's `eventSecret`
 * using the same canonical-JSON + HMAC-SHA256 scheme as
 * `@waitlayer/shared` `signPayload`, matching the server's
 * `verifyDeviceSignature`.
 */
const crypto = require('crypto');
const { PrismaClient } = require('@waitlayer/db');
const { canonicalJson } = require('@waitlayer/shared');
const bcrypt = require('bcryptjs');

const BASE = 'http://localhost:4000/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-local-super-secret-jwt-key-please-change-32+';
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ? '-> ' + detail : ''}`);
}

function jwt(payload, expSec = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

// Unique X-Forwarded-For per process so back-to-back runs each see a fresh
// IP for the throttler's `auth-short`/`auth-long` buckets. The API runs with
// `trust proxy = 1` (default), so the closest XFF hop becomes `req.ip`.
// Without this, the second `node live-e2e.cjs` within <60s eats the prior
// one's 10-req/min bucket and starts returning 429s — that's correct API
// behavior, not a bug; we just need fresh IPs for repeatable harness runs.
const RUN_IP = `10.${(Math.floor(Date.now() / 1000) % 254) + 1}.${(Math.floor(Date.now() / 60000) % 254) + 1}.${(Math.floor(Math.random() * 254) + 1)}`;

async function req(method, path, { body, token, headers } = {}) {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': RUN_IP, ...(headers || {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = await res.text(); }
  return { status: res.status, data };
}

/** Sign a payload object (without the `signature` field) using the device
 *  eventSecret, matching the server's canonical-JSON HMAC verification. */
function signEvent(payload, secret) {
  const { signature: _, ...rest } = payload;
  return crypto.createHmac('sha256', secret).update(canonicalJson(rest)).digest('hex');
}

// TOTP (RFC 6238) to drive the 2FA flow live.
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0, out = [];
  for (const c of s) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret, step = 30, digits = 6) {
  const key = b32decode(secret);
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

const uniqueId = () => crypto.randomUUID();

(async () => {
  const prisma = new PrismaClient();
  let r;

  // ---------- DEVELOPER JOURNEY ----------
  const devEmail = `dev-live-${Date.now()}@test.com`;
  const pw = 'Password123!';
  r = await req('POST', '/auth/signup', { body: { email: devEmail, password: pw, role: 'developer', country: 'US' } });
  rec('dev signup', r.status === 201, r.status + ' ' + (r.data?.user?.id || ''));
  const devId = r.data?.user?.id;

  // login before verification
  r = await req('POST', '/auth/login', { body: { email: devEmail, password: pw } });
  rec('dev login (unverified)', r.status === 200 || r.status === 403, r.status);

  // verify email via minted token
  r = await req('POST', '/auth/verify-email/confirm', { body: { token: jwt({ action: 'email-verification', sub: devId || '', email: devEmail }) } });
  rec('dev verify-email', r.status === 200 || r.status === 201, r.status + ' ' + (r.data?.message || '').slice(0, 40));

  // login verified
  r = await req('POST', '/auth/login', { body: { email: devEmail, password: pw } });
  const devToken = r.data?.accessToken;
  rec('dev login (verified)', r.status === 200 && !!devToken, r.status);

  // Extension device registration — register-device returns deviceId + eventSecret
  const fp = crypto.createHash('sha256').update(devEmail + '::vscode').digest('hex');
  r = await req('POST', '/extension/register-device', {
    body: { toolType: 'vscode', fingerprintHash: fp, extensionVersion: '1.0.0', platform: 'linux' },
    token: devToken,
  });
  rec('extension register-device', r.status === 200 && !!r.data?.id, r.status + (r.data?.id ? ' deviceId=' + r.data.id : ' ' + JSON.stringify(r.data).slice(0, 120)));
  const deviceId = r.data?.id;
  const eventSecret = r.data?.eventSecret;

  // wait-state/start (signed)
  const wsId = 'ws_' + Date.now();
  const startPayload = {
    deviceId,
    sessionId: 'sess_' + Date.now(),
    toolType: 'vscode',
    waitStateId: wsId,
    idempotencyKey: uniqueId(),
  };
  let signed = { ...startPayload, signature: signEvent(startPayload, eventSecret) };
  r = await req('POST', '/extension/wait-state/start', { body: signed, token: devToken });
  rec('wait-state start', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));

  // ad-request (signed). On the first run with no approved campaigns this returns
  // ad:null (reason: no_eligible_campaign). Once a campaign with an approved creative
  // exists (created below in the advertiser journey + admin-approve), subsequent runs
  // receive a real ad with an impressionToken and exercise the full render/qualify/click chain.
  const arPayload = {
    deviceId,
    sessionId: startPayload.sessionId,
    waitStateId: wsId,
    toolType: 'vscode',
    idempotencyKey: uniqueId(),
  };
  signed = { ...arPayload, signature: signEvent(arPayload, eventSecret) };
  r = await req('POST', '/extension/ad-request', { body: signed, token: devToken });
  rec('ad-request', r.status === 200, r.status + ' ad=' + (!!r.data?.ad) + (r.data?.ad ? '' : ' reason=' + r.data?.reason));
  const impressionToken = r.data?.ad?.impressionToken;

  // If an ad was served, drive the full qualified-impression + click lifecycle.
  // qualification requires visibleDurationMs >= MINIMUM_VISIBLE_DURATION_MS (5000).
  if (impressionToken) {
    const renderP = { impressionToken, renderedAt: new Date().toISOString(), visibleSurface: 80, idempotencyKey: uniqueId() };
    signed = { ...renderP, signature: signEvent(renderP, eventSecret) };
    r = await req('POST', '/extension/ad-rendered', { body: signed, token: devToken });
    rec('ad-rendered', r.status === 200, r.status);

    const qualP = { impressionToken, qualifiedAt: new Date().toISOString(), visibleDurationMs: 7000, idempotencyKey: uniqueId() };
    signed = { ...qualP, signature: signEvent(qualP, eventSecret) };
    r = await req('POST', '/extension/impression-qualified', { body: signed, token: devToken });
    rec('impression-qualified', r.status === 200 && r.data?.qualified === true, r.status + ' qualified=' + r.data?.qualified + (r.data?.reason ? ' reason=' + r.data?.reason : ''));

    const clickP = { impressionToken, clickedAt: new Date().toISOString(), idempotencyKey: uniqueId() };
    signed = { ...clickP, signature: signEvent(clickP, eventSecret) };
    r = await req('POST', '/extension/click', { body: signed, token: devToken });
    rec('click', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  } else {
    rec('ad-rendered (skipped, no ad served)', true, 'skip');
    rec('impression-qualified (skipped, no ad served)', true, 'skip');
    rec('click (skipped, no ad served)', true, 'skip');
  }

  r = await req('GET', '/developer/earnings', { token: devToken });
  rec('dev earnings', r.status === 200, r.status);

  // Payout method — stripe_connect requires an acct_ destination.
  r = await req('POST', '/payout/method', {
    body: { provider: 'stripe_connect', destination: 'acct_1Qctest' + (Date.now() % 100000), currency: 'USD' },
    token: devToken,
  });
  rec('payout method', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  const payoutAccountId = r.data?.id;

  // payout request — likely rejected (insufficient confirmed earnings). 400/201 both acceptable.
  r = await req('POST', '/payout/request', {
    body: { payoutAccountId, amountMinor: 100, currency: 'USD' },
    token: devToken,
  });
  rec('payout request', r.status === 201 || r.status === 400, r.status + (r.data?.message ? ' ' + (typeof r.data.message === 'string' ? r.data.message : JSON.stringify(r.data.message)) : ''));

  // ---------- 2FA JOURNEY ----------
  r = await req('POST', '/auth/2fa/setup', { token: devToken });
  rec('2fa setup', r.status === 200 && !!r.data?.secret, r.status + ' secret=' + (r.data?.secret ? '✓' : '✗'));
  const secret = r.data?.secret;
  const code = totp(secret);
  r = await req('POST', '/auth/2fa/enable', { body: { token: code }, token: devToken });
  rec('2fa enable', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));

  // WaitLayer's 2FA model is inline: the TOTP code is sent in the login body
  // as `twoFactorToken`. Login WITHOUT it is rejected 401; login WITH a valid
  // code returns 200 + tokens. There is no step-up challenge envelope by design.
  r = await req('POST', '/auth/login', { body: { email: devEmail, password: pw } });
  rec('2FA login without code -> 401', r.status === 401, r.status);
  const code2 = totp(secret);
  r = await req('POST', '/auth/login', { body: { email: devEmail, password: pw, twoFactorToken: code2 } });
  rec('2FA login with valid code -> 200', r.status === 200 && !!r.data?.accessToken, r.status);

  // ---------- CONSENT ----------
  r = await req('POST', '/consent', { body: { purpose: 'privacy_policy', version: '2026-07-01', granted: true }, token: devToken });
  rec('consent record', r.status === 201 || r.status === 200, r.status);
  r = await req('GET', '/consent/privacy_policy/status', { token: devToken });
  rec('consent status', r.status === 200, r.status);

  // ---------- ADVERTISER JOURNEY ----------
  const advEmail = `adv-live-${Date.now()}@test.com`;
  r = await req('POST', '/auth/signup', { body: { email: advEmail, password: pw, role: 'advertiser', country: 'US' } });
  rec('adv signup', r.status === 201, r.status + ' uid=' + (r.data?.user?.id || ''));
  const advId = r.data?.user?.id;
  r = await req('POST', '/auth/verify-email/confirm', { body: { token: jwt({ action: 'email-verification', sub: advId || '', email: advEmail }) } });
  rec('adv verify-email', r.status === 200 || r.status === 201, r.status);
  r = await req('POST', '/auth/login', { body: { email: advEmail, password: pw } });
  const advToken = r.data?.accessToken;
  rec('adv login', r.status === 200 && !!advToken, r.status);

  // Signup auto-creates an advertiser profile stub (see auth.service onboarding),
  // so POST /advertiser/profile must return 400 ("already exists"). The reachable
  // flow is GET /advertiser/profile (getOrCreateProfile) + PATCH campaigns. Assert
  // the expected conflict first, then fetch the stub.
  r = await req('POST', '/advertiser/profile', { body: { companyName: 'Acme', billingEmail: advEmail, websiteUrl: 'https://acme.test' }, token: advToken });
  rec('adv profile (duplicate rejected)', r.status === 400, r.status + ' ' + (r.data?.message || '').slice(0, 40));
  r = await req('GET', '/advertiser/profile', { token: advToken });
  rec('adv profile fetch', r.status === 200 && !!r.data?.id, r.status + ' id=' + (r.data?.id || ''));

  // create campaign — DTO: name, category, bidType (cpm/cpc), currency, bidAmountMinor, budgetTotalMinor
  r = await req('POST', '/advertiser/campaigns', {
    body: { name: 'Brand Launch', category: 'ai', bidType: 'cpc', currency: 'USD', bidAmountMinor: 50, budgetTotalMinor: 50000, frequencyCapPerHour: 5 },
    token: advToken,
  });
  rec('adv campaign', r.status === 201 || r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  const campId = r.data?.id;

  // Campaign submission requires at least one creative. Create one, then submit.
  // Creative lives under /campaigns/:id/creatives (the campaigns controller).
  r = await req('POST', `/campaigns/${campId}/creatives`, {
    body: { title: 'Try WaitLayer', sponsoredMessage: 'Monetize your AI wait time.', destinationUrl: 'https://waitlayer.test', displayDomain: 'waitlayer.test' },
    token: advToken,
  });
  rec('adv creative', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  const creativeId = r.data?.id;

  r = await req('POST', `/advertiser/campaigns/${campId}/submit`, { token: advToken });
  rec('adv submit', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));

  // ---------- ADMIN JOURNEY ----------
  const adminEmail = `admin-live-${Date.now()}@test.com`;
  await prisma.user.create({ data: { email: adminEmail, passwordHash: await bcrypt.hash(pw, 10), name: 'Admin', role: 'admin', status: 'active', emailVerified: true, country: 'US' } });
  r = await req('POST', '/auth/login', { body: { email: adminEmail, password: pw } });
  const adminToken = r.data?.accessToken;
  rec('admin login', r.status === 200 && !!adminToken, r.status);

  r = await req('GET', '/admin/overview', { token: adminToken });
  rec('admin overview', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));

  r = await req('GET', '/admin/campaigns/pending', { token: adminToken });
  rec('admin campaigns pending', r.status === 200, r.status);

  if (creativeId) {
    // Admin approves the creative first (requestAd filters on approved creatives).
    r = await req('POST', `/campaigns/creatives/${creativeId}/approve`, { token: adminToken });
    rec('admin approve creative', r.status === 200, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  }
  if (campId) {
    r = await req('POST', `/admin/campaigns/${campId}/approve`, { body: { reason: 'ok' }, token: adminToken });
    rec('admin approve campaign', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  }

  // pending payouts (may be empty) + fraud flags
  r = await req('GET', '/admin/payouts/pending', { token: adminToken });
  rec('admin payouts pending', r.status === 200, r.status);
  r = await req('GET', '/admin/fraud', { token: adminToken });
  rec('admin fraud list', r.status === 200, r.status);

  // ---------- HEALTH / METRICS ----------
  r = await req('GET', '/health');
  rec('health', r.status === 200, r.status);
  r = await req('GET', '/health/metrics', { token: adminToken });
  rec('health/metrics (admin)', r.status === 200, r.status + ' ' + (typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 100) : r.data));

  await prisma.$disconnect();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail)); process.exit(1); }
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
