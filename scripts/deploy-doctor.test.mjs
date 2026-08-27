import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  diagnoseEnvironment,
  diagnoseMigrationState,
  diagnoseMoneySwitches,
  probeNetwork,
  probeWeb,
} from './deploy-doctor.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const BASE = {
  NODE_ENV: 'production',
  ATEVA_ENVIRONMENT_KIND: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example/ateva',
  REDIS_URL: 'rediss://:redis-password@redis.example:6380',
  API_BASE_URL: 'https://api.example.com',
  WEB_BASE_URL: 'https://app.example.com',
  NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1',
  API_INTERNAL_URL: 'http://api:4002/api/v1',
  NEXT_PUBLIC_WEB_URL: 'https://app.example.com',
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  JWT_PRIVATE_KEY: PRIVATE_PEM.replaceAll('\n', '\\n'),
  JWT_PUBLIC_KEY: PUBLIC_PEM.replaceAll('\n', '\\n'),
  JWT_SECRET: 'a-production-secret-that-is-long-enough-123',
};

function finding(findings, name) {
  return findings.find((item) => item.name === name);
}

test('accepts a complete production-shaped environment without exposing values', () => {
  const findings = diagnoseEnvironment(BASE);
  assert.equal(
    findings.some((item) => item.level === 'FAIL'),
    false,
  );
  const rendered = findings.map((item) => `${item.name} ${item.detail}`).join('\n');
  assert.doesNotMatch(
    rendered,
    /password|redis-password|production-secret|BEGIN PRIVATE KEY|client\.apps/,
  );
});

test('rejects missing production infrastructure, auth, URLs, and OAuth inputs', () => {
  const findings = diagnoseEnvironment({
    NODE_ENV: 'production',
    ATEVA_ENVIRONMENT_KIND: 'production',
  });
  for (const name of ['database_url', 'redis-config', 'jwt-keys', 'web-api-url', 'google-oauth']) {
    assert.equal(finding(findings, name).level, 'FAIL', `${name} should fail closed`);
  }
});

test('rejects mismatched or malformed JWT material', () => {
  const mismatched = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
  const findings = diagnoseEnvironment({ ...BASE, JWT_PUBLIC_KEY: mismatched });
  assert.match(finding(findings, 'jwt-keys').detail, /do not form one key pair/);

  const malformed = diagnoseEnvironment({ ...BASE, JWT_PRIVATE_KEY: 'not-a-key' });
  assert.match(finding(malformed, 'jwt-keys').detail, /not valid PEM/);
});

test('rejects non-HTTPS public endpoints and inconsistent API paths', () => {
  const findings = diagnoseEnvironment({
    ...BASE,
    NEXT_PUBLIC_API_URL: 'http://api.example.com/api/v1',
    API_INTERNAL_URL: 'http://api:4002/internal',
    WEB_BASE_URL: 'https://app.example.com/path',
  });
  assert.equal(finding(findings, 'next-public-api-url').level, 'FAIL');
  assert.equal(finding(findings, 'api-internal-url').level, 'FAIL');
  assert.equal(finding(findings, 'web-base-url').level, 'FAIL');
});

test('rejects known unowned project domains from public runtime URLs', () => {
  const findings = diagnoseEnvironment({
    ...BASE,
    API_BASE_URL: 'https://api.ateva.com',
    WEB_BASE_URL: 'https://www.ateva.dev',
    NEXT_PUBLIC_API_URL: 'https://api.waitlayer.com/api/v1',
    NEXT_PUBLIC_WEB_URL: 'https://ateva.com',
  });
  for (const name of [
    'api-base-url',
    'web-base-url',
    'next-public-api-url',
    'next-public-web-url',
  ]) {
    assert.equal(finding(findings, name).level, 'FAIL', `${name} should fail closed`);
    assert.match(finding(findings, name).detail, /known unowned project domain/);
  }
});

test('uses the API Google OAuth ID as the sole client-ID source and validates Dodo configuration', () => {
  const oauth = diagnoseEnvironment({
    ...BASE,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'other.apps.googleusercontent.com',
  });
  assert.equal(finding(oauth, 'google-oauth').level, 'PASS');
  assert.match(finding(oauth, 'google-oauth').detail, /\/auth\/config/);

  const dodoEnv = {
    ...BASE,
    DEPOSIT_PROCESSOR: 'dodo',
    DODO_API_KEY: 'key',
    DODO_BASE_URL: 'https://test.dodopayments.com',
    DODO_WEBHOOK_SECRET: 'secret',
    DODO_PRODUCT_ID: 'product',
  };
  const dodo = diagnoseEnvironment(dodoEnv);
  assert.equal(finding(dodo, 'dodo').level, 'FAIL');

  const live = diagnoseEnvironment({
    ...dodoEnv,
    DODO_BASE_URL: 'https://live.dodopayments.com',
  });
  assert.equal(finding(live, 'dodo').level, 'PASS');
});

test('reports enabled money switches without changing them', () => {
  assert.equal(diagnoseMoneySwitches([]).level, 'PASS');
  const settings = [
    { scope: 'deposits', target: 'global', value: { enabled: true } },
    { scope: 'payouts', target: 'auto', value: { enabled: false } },
  ];
  const result = diagnoseMoneySwitches(settings);
  assert.equal(result.level, 'FAIL');
  assert.match(result.detail, /deposits\.global/);
  assert.deepEqual(settings[0].value, { enabled: true });
});

test('migration probe passes only when every on-disk migration is applied', () => {
  const applied = new Set(['0_init', '20260801000000_x', '20260802000000_y']);
  const pass = diagnoseMigrationState({
    onDisk: ['0_init', '20260801000000_x', '20260802000000_y'],
    applied,
    failed: [],
  });
  assert.equal(pass.level, 'PASS');
  assert.match(pass.detail, /3 migration\(s\) applied/);
});

test('migration probe fails on a database that is merely BEHIND (no failed rows)', () => {
  const applied = new Set(['0_init', '20260801000000_x']);
  const result = diagnoseMigrationState({
    onDisk: ['0_init', '20260801000000_x', '20260802000000_y', '20260803000000_z'],
    applied,
    failed: [],
  });
  assert.equal(result.level, 'FAIL');
  assert.match(result.detail, /2 migration\(s\) not applied/);
  assert.match(result.detail, /20260802000000_y/);
});

test('migration probe fails on unfinished (failed) migrations', () => {
  const applied = new Set(['0_init']);
  const result = diagnoseMigrationState({
    onDisk: ['0_init', '20260801000000_x'],
    applied,
    failed: ['20260801000000_x'],
  });
  assert.equal(result.level, 'FAIL');
  assert.match(result.detail, /1 migration\(s\) unfinished/);
});

test('probes the versioned API health route without reading a response body', async () => {
  let requestedUrl;
  const result = await probeNetwork(
    { API_BASE_URL: 'https://api.example.com' },
    async (url, init) => {
      requestedUrl = String(url);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Accept, 'application/json');
      return { ok: true, status: 200 };
    },
  );
  assert.equal(result.level, 'PASS');
  assert.equal(requestedUrl, 'https://api.example.com/api/v1/health');
});

test('never turns an API error or network failure into a confident pass', async () => {
  const httpError = await probeNetwork({ API_BASE_URL: 'https://api.example.com' }, async () => ({
    ok: false,
    status: 503,
  }));
  assert.equal(httpError.level, 'FAIL');

  const networkError = await probeNetwork({ API_BASE_URL: 'https://api.example.com' }, async () => {
    throw new Error('secret must not escape');
  });
  assert.equal(networkError.level, 'FAIL');
  assert.doesNotMatch(networkError.detail, /secret/);
});

test('probes the web shell, login route, and same-origin auth config without reading bodies', async () => {
  const requestedUrls = [];
  const result = await probeWeb(
    { NODE_ENV: 'production', WEB_BASE_URL: 'https://app.example.com' },
    async (url, init) => {
      requestedUrls.push(String(url));
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Accept, 'text/html,application/json');
      return { ok: true, status: 200 };
    },
  );
  assert.equal(result.level, 'PASS');
  assert.deepEqual(requestedUrls, [
    'https://app.example.com/',
    'https://app.example.com/auth/login',
    'https://app.example.com/api/auth/config',
  ]);
  assert.match(result.detail, /3 web routes returned 2xx/);
});

test('fails the web probe when a required route is missing or unreachable', async () => {
  const missingRoute = await probeWeb(
    { NODE_ENV: 'production', WEB_BASE_URL: 'https://app.example.com' },
    async (url) => ({
      ok: !String(url).endsWith('/auth/login'),
      status: String(url).endsWith('/auth/login') ? 404 : 200,
    }),
  );
  assert.equal(missingRoute.level, 'FAIL');
  assert.match(missingRoute.detail, /\/auth\/login HTTP 404/);

  const unreachable = await probeWeb(
    { NODE_ENV: 'production', WEB_BASE_URL: 'https://app.example.com' },
    async () => {
      throw new Error('secret must not escape');
    },
  );
  assert.equal(unreachable.level, 'FAIL');
  assert.match(unreachable.detail, /\/ unreachable/);
  assert.doesNotMatch(unreachable.detail, /secret/);
});
