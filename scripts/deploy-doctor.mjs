#!/usr/bin/env node
/**
 * Read-only deployment diagnostics.
 *
 * This answers "what is wrong with this deployment environment?" without
 * enabling a switch, mutating the database, creating a checkout, or printing
 * credentials. The default run is local and deterministic; optional probes are
 * explicit because network/database checks are not appropriate in every CI
 * invocation.
 *
 *   pnpm deploy:doctor
 *   pnpm deploy:doctor --with-network
 *   pnpm deploy:doctor --with-db
 *
 * `--with-db` is read-only: it runs SELECT 1, checks migration state, and
 * reports the five money switches. It never changes settings.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 4_000;
const DODO_HOSTS = new Set(['test.dodopayments.com', 'live.dodopayments.com']);
const WEB_SMOKE_PATHS = ['/', '/auth/login', '/api/auth/config'];
// These are historical project-looking domains that are not owned by Ateva.
// Public release URLs must never point at them, even if a stale secret does.
const UNOWNED_PROJECT_DOMAIN_SUFFIXES = ['ateva.com', 'ateva.dev', 'waitlayer.com'];
const MONEY_SWITCHES = [
  ['ads', 'global'],
  ['wait', 'earnings'],
  ['deposits', 'global'],
  ['payouts', 'requests'],
  ['payouts', 'auto'],
];

function pass(name, detail) {
  return { level: 'PASS', name, detail };
}
function warn(name, detail) {
  return { level: 'WARN', name, detail };
}
function fail(name, detail) {
  return { level: 'FAIL', name, detail };
}

function normalizedPem(value) {
  return value?.replace(/\\n/g, '\n').trim() ?? '';
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isSingleLabel(hostname) {
  return !hostname.includes('.') && !isIP(hostname);
}

function usesUnownedProjectDomain(hostname) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  return UNOWNED_PROJECT_DOMAIN_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

function parseUrl(
  value,
  name,
  { production = false, path = null, allowInternalHttp = false } = {},
) {
  if (!value) return { finding: fail(name, `${name} is required`) };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { finding: fail(name, `${name} must be a valid URL`) };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (usesUnownedProjectDomain(hostname)) {
    return {
      finding: fail(name, `${name} must not use a known unowned project domain`),
    };
  }
  const httpAllowed =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      (isLoopback(hostname) || (allowInternalHttp && isSingleLabel(hostname))));
  if (!httpAllowed || url.username || url.password || url.search || url.hash) {
    return {
      finding: fail(
        name,
        `${name} must use HTTPS without credentials, query parameters, or fragments` +
          (allowInternalHttp ? ' (loopback/single-label HTTP is allowed internally)' : ''),
      ),
    };
  }
  if (production && url.protocol !== 'https:') {
    return { finding: fail(name, `${name} must use HTTPS in production`) };
  }
  if (path === '' && url.pathname !== '' && url.pathname !== '/') {
    return { finding: fail(name, `${name} must be an origin without a path`) };
  }
  if (path !== null && path !== '' && url.pathname !== path) {
    return { finding: fail(name, `${name} must end exactly in ${path}`) };
  }
  return {
    url,
    finding: pass(name, `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`),
  };
}

function checkDatabaseUrl(env) {
  const findings = [];
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = env[name];
    if (!value) {
      if (name === 'DATABASE_URL') findings.push(fail(name.toLowerCase(), `${name} is required`));
      continue;
    }
    try {
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
        findings.push(fail(name.toLowerCase(), `${name} must be a PostgreSQL connection URL`));
      } else {
        findings.push(
          pass(
            name.toLowerCase(),
            `PostgreSQL target ${url.hostname}${url.port ? `:${url.port}` : ''}`,
          ),
        );
      }
    } catch {
      findings.push(fail(name.toLowerCase(), `${name} must be a valid PostgreSQL connection URL`));
    }
  }
  return findings;
}

function checkRedisUrl(env, production) {
  if (!env.REDIS_URL) {
    return [
      production
        ? fail('redis-config', 'REDIS_URL is required in production')
        : warn('redis-config', 'REDIS_URL is unset; local in-memory rate limits may be used'),
    ];
  }
  try {
    const url = new URL(env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(url.protocol) || url.username) {
      return [fail('redis-config', 'REDIS_URL must use redis:// or rediss:// without a username')];
    }
    return [
      pass('redis-config', `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`),
    ];
  } catch {
    return [fail('redis-config', 'REDIS_URL must be a valid redis:// or rediss:// URL')];
  }
}

function checkJwt(env, production) {
  const findings = [];
  const supplied = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY'].filter((name) => env[name]);
  if (production && supplied.length !== 2) {
    findings.push(
      fail('jwt-keys', 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are both required in production'),
    );
    return findings;
  }
  if (supplied.length === 0) {
    findings.push(warn('jwt-keys', 'JWT key pair is unset outside production'));
    return findings;
  }
  if (supplied.length !== 2) {
    findings.push(
      fail('jwt-keys', 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be configured together'),
    );
    return findings;
  }

  try {
    const privateKey = createPrivateKey(normalizedPem(env.JWT_PRIVATE_KEY));
    const configuredPublic = createPublicKey(normalizedPem(env.JWT_PUBLIC_KEY));
    if (privateKey.asymmetricKeyType !== 'rsa' || configuredPublic.asymmetricKeyType !== 'rsa') {
      findings.push(fail('jwt-keys', 'JWT key pair must use RSA keys'));
      return findings;
    }
    const derivedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const suppliedPublic = configuredPublic.export({ type: 'spki', format: 'der' });
    if (!Buffer.from(derivedPublic).equals(Buffer.from(suppliedPublic))) {
      findings.push(
        fail('jwt-keys', 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY do not form one key pair'),
      );
      return findings;
    }
    findings.push(pass('jwt-keys', 'RSA signing and verification keys parse and match'));
  } catch {
    findings.push(fail('jwt-keys', 'JWT_PRIVATE_KEY/JWT_PUBLIC_KEY are not valid PEM keys'));
  }

  if (env.JWT_PUBLIC_KEYS) {
    const blocks = normalizedPem(env.JWT_PUBLIC_KEYS)
      .split(/(?=-----BEGIN PUBLIC KEY-----)/g)
      .filter(Boolean);
    if (
      blocks.length === 0 ||
      blocks.some((block) => {
        try {
          return createPublicKey(block).asymmetricKeyType !== 'rsa';
        } catch {
          return true;
        }
      })
    ) {
      findings.push(fail('jwt-public-keys', 'JWT_PUBLIC_KEYS contains an invalid public key'));
    } else {
      findings.push(pass('jwt-public-keys', `${blocks.length} additional RSA public key(s) parse`));
    }
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    findings.push(
      production
        ? fail('jwt-secret', 'JWT_SECRET must be at least 32 characters in production')
        : warn('jwt-secret', 'JWT_SECRET is absent or short outside production'),
    );
  } else {
    findings.push(pass('jwt-secret', 'present with required minimum length'));
  }
  return findings;
}

function checkUrls(env, production) {
  const findings = [];
  const api = parseUrl(env.API_BASE_URL, 'api-base-url', { production, path: '' });
  const web = parseUrl(env.WEB_BASE_URL, 'web-base-url', { production, path: '' });
  findings.push(api.finding, web.finding);

  const publicApi = env.NEXT_PUBLIC_API_URL;
  const internalApi = env.API_INTERNAL_URL;
  if (!publicApi && !internalApi) {
    findings.push(fail('web-api-url', 'NEXT_PUBLIC_API_URL or API_INTERNAL_URL is required'));
  } else {
    if (publicApi) {
      findings.push(
        parseUrl(publicApi, 'next-public-api-url', {
          production,
          path: '/api/v1',
        }).finding,
      );
    }
    if (internalApi) {
      findings.push(
        parseUrl(internalApi, 'api-internal-url', {
          production: false,
          path: '/api/v1',
          allowInternalHttp: true,
        }).finding,
      );
    }
    if (publicApi && internalApi) {
      try {
        const publicUrl = new URL(publicApi);
        const internalUrl = new URL(internalApi);
        if (publicUrl.pathname !== internalUrl.pathname) {
          findings.push(
            fail(
              'web-api-url-consistency',
              'public and internal API URLs must use the same /api/v1 path',
            ),
          );
        } else {
          findings.push(pass('web-api-url-consistency', 'public and internal API paths agree'));
        }
      } catch {
        // The individual URL findings already explain the malformed value.
      }
    }
  }
  if (production && !env.NEXT_PUBLIC_WEB_URL) {
    findings.push(
      fail('next-public-web-url', 'NEXT_PUBLIC_WEB_URL is required for the production web build'),
    );
  } else if (env.NEXT_PUBLIC_WEB_URL) {
    findings.push(
      parseUrl(env.NEXT_PUBLIC_WEB_URL, 'next-public-web-url', { production, path: '' }).finding,
    );
  }
  return findings;
}

function checkOAuth(env, production) {
  const apiId = env.GOOGLE_CLIENT_ID?.trim();
  if (!apiId) {
    return [
      production
        ? fail('google-oauth', 'GOOGLE_CLIENT_ID is required in production')
        : warn('google-oauth', 'Google OAuth is not configured outside production'),
    ];
  }
  return [
    pass('google-oauth', 'API Google client ID configured; web discovers it through /auth/config'),
  ];
}

function checkDodo(env, production) {
  const names = ['DODO_API_KEY', 'DODO_BASE_URL', 'DODO_WEBHOOK_SECRET', 'DODO_PRODUCT_ID'];
  const configured = names.filter((name) => Boolean(env[name]));
  if (configured.length === 0 && env.DEPOSIT_PROCESSOR !== 'dodo') {
    return [pass('dodo', 'inactive; deposits remain fail-closed')];
  }
  if (configured.length !== names.length || env.DEPOSIT_PROCESSOR !== 'dodo') {
    return [fail('dodo', 'Dodo values and DEPOSIT_PROCESSOR=dodo must be configured together')];
  }
  const findings = [];
  let url;
  try {
    url = new URL(env.DODO_BASE_URL);
    const validHost = DODO_HOSTS.has(url.hostname.toLowerCase());
    if (
      url.protocol !== 'https:' ||
      !validHost ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      findings.push(fail('dodo', 'DODO_BASE_URL must be an HTTPS test/live Dodo API origin'));
    } else if (production && url.hostname.toLowerCase() !== 'live.dodopayments.com') {
      findings.push(fail('dodo', 'production Dodo deposits must use live.dodopayments.com'));
    } else {
      findings.push(
        pass('dodo', `${url.hostname} configured with webhook verification and product id`),
      );
    }
  } catch {
    findings.push(fail('dodo', 'DODO_BASE_URL must be a valid Dodo API URL'));
  }
  return findings;
}

function checkEnvironment(env) {
  const production = env.NODE_ENV === 'production';
  const findings = [];
  findings.push(
    production
      ? pass('node-env', 'production')
      : warn(
          'node-env',
          `NODE_ENV=${env.NODE_ENV ?? 'unset'}; production-only checks are advisory`,
        ),
  );
  if (env.COOKIE_SECURE === 'false')
    findings.push(fail('cookie-secure', 'COOKIE_SECURE=false is unsafe for deployment'));
  else findings.push(pass('cookie-secure', 'not explicitly disabled'));
  for (const name of ['ALLOW_MOCK_GOOGLE', 'MOCK_GOOGLE_ENABLED', 'NEXT_PUBLIC_ALLOW_MOCK_AUTH']) {
    if (['1', 'true'].includes(String(env[name] ?? '').toLowerCase())) {
      findings.push(fail('mock-auth', `${name} is enabled`));
    }
  }
  if (!findings.some((finding) => finding.name === 'mock-auth'))
    findings.push(pass('mock-auth', 'no mock-auth flag enabled'));
  const throttleOverrides = Object.keys(env).filter(
    (name) => name.startsWith('THROTTLE_') && env[name] !== undefined && env[name] !== '',
  );
  findings.push(
    throttleOverrides.length > 0
      ? fail(
          'throttle-overrides',
          `${throttleOverrides.join(', ')} must not be present on a public deployment`,
        )
      : pass('throttle-overrides', 'none set'),
  );
  if (production && env.ATEVA_ENVIRONMENT_KIND !== 'production') {
    findings.push(
      fail('environment-kind', 'production NODE_ENV requires ATEVA_ENVIRONMENT_KIND=production'),
    );
  } else {
    findings.push(pass('environment-kind', env.ATEVA_ENVIRONMENT_KIND ?? 'unset'));
  }
  findings.push(...checkDatabaseUrl(env));
  findings.push(...checkRedisUrl(env, production));
  findings.push(...checkJwt(env, production));
  findings.push(...checkUrls(env, production));
  findings.push(...checkOAuth(env, production));
  findings.push(...checkDodo(env, production));
  return findings;
}

/**
 * Pure environment diagnosis used by the CLI and contract tests. It never
 * returns secret values; findings contain names, protocols, and hostnames only.
 */
export function diagnoseEnvironment(env = process.env) {
  return checkEnvironment(env);
}

export function diagnoseMoneySwitches(settings) {
  const enabled = new Set(
    settings
      .filter(
        (setting) =>
          setting?.value && typeof setting.value === 'object' && setting.value.enabled === true,
      )
      .map((setting) => `${setting.scope}.${setting.target}`),
  );
  const unexpected = MONEY_SWITCHES.map(([scope, target]) => `${scope}.${target}`).filter((key) =>
    enabled.has(key),
  );
  return unexpected.length === 0
    ? pass('money-switches', 'all five switches are OFF')
    : fail('money-switches', `ENABLED: ${unexpected.join(', ')}`);
}

async function probeRedis(env) {
  if (!env.REDIS_URL) return fail('redis-reachability', 'REDIS_URL is unavailable');
  try {
    const url = new URL(env.REDIS_URL);
    const net = await import('node:net');
    await new Promise((resolvePromise, rejectPromise) => {
      const socket = net.createConnection(
        { host: url.hostname, port: Number(url.port || 6379) },
        () => {
          socket.end();
          resolvePromise();
        },
      );
      socket.setTimeout(DEFAULT_TIMEOUT_MS, () => {
        socket.destroy();
        rejectPromise(new Error('timeout'));
      });
      socket.on('error', rejectPromise);
    });
    return pass('redis-reachability', `socket reachable at ${url.hostname}:${url.port || 6379}`);
  } catch {
    return fail('redis-reachability', 'Redis socket was unreachable');
  }
}

/**
 * Migration-state verdict from the on-disk migration list and the applied/
 * failed names recorded in `_prisma_migrations`. A database that is simply
 * BEHIND has no rows for the migrations it never ran, so "finished_at IS
 * NULL" alone cannot detect it (P1, PR #47): unapplied = on-disk − applied.
 */
export function diagnoseMigrationState({ onDisk, applied, failed }) {
  const unapplied = onDisk.filter((name) => !applied.has(name));
  if (failed.length > 0) {
    return fail(
      'database-migrations',
      `${failed.length} migration(s) unfinished: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ', …' : ''}`,
    );
  }
  if (unapplied.length > 0) {
    return fail(
      'database-migrations',
      `${unapplied.length} migration(s) not applied: ${unapplied.slice(0, 5).join(', ')}${unapplied.length > 5 ? ', …' : ''}`,
    );
  }
  return pass('database-migrations', `${applied.size} migration(s) applied; schema up to date`);
}

async function probeDatabase(env) {
  if (!env.DATABASE_URL) return [fail('database-reachability', 'DATABASE_URL is unavailable')];
  try {
    const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
    const { PrismaClient, createPrismaAdapter } = require('@ateva/db');
    const prisma = new PrismaClient({ adapter: createPrismaAdapter(env.DATABASE_URL) });
    try {
      await prisma.$queryRaw`SELECT 1`;
      const appliedRows =
        await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
      const failedRows =
        await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL`;
      const applied = new Set(
        (Array.isArray(appliedRows) ? appliedRows : [])
          .map((row) => row?.migration_name)
          .filter(Boolean),
      );
      const failed = (Array.isArray(failedRows) ? failedRows : [])
        .map((row) => row?.migration_name)
        .filter(Boolean);
      let onDisk = [];
      let migrationReadError = null;
      try {
        const migrationsDir = new URL('../packages/db/prisma/migrations', import.meta.url);
        onDisk = (await readdir(migrationsDir)).filter((name) => !name.startsWith('.'));
      } catch {
        migrationReadError = new Error('unable to read the migrations directory');
      }
      const findings = [pass('database-reachability', 'PostgreSQL query succeeded')];
      findings.push(
        migrationReadError
          ? fail('database-migrations', migrationReadError.message)
          : diagnoseMigrationState({ onDisk, applied, failed }),
      );
      const settings = await prisma.systemSetting.findMany({
        where: { OR: MONEY_SWITCHES.map(([scope, target]) => ({ scope, target })) },
        select: { scope: true, target: true, value: true },
      });
      findings.push(diagnoseMoneySwitches(settings));
      return findings;
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  } catch {
    return [fail('database-reachability', 'PostgreSQL query failed')];
  }
}

export async function probeNetwork(env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const raw = env.API_INTERNAL_URL || env.API_BASE_URL;
  if (!raw) return fail('api-reachability', 'API_INTERNAL_URL/API_BASE_URL is unavailable');
  const parsed = parseUrl(raw, 'api-reachability', {
    production: env.NODE_ENV === 'production',
    allowInternalHttp: true,
  });
  if (!parsed.url) return parsed.finding;
  const url = parsed.url;
  const basePath = url.pathname.replace(/\/$/, '');
  url.pathname = `${basePath || '/api/v1'}/health`;
  url.search = '';
  url.hash = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return response.ok
      ? pass('api-reachability', `health endpoint returned HTTP ${response.status}`)
      : fail('api-reachability', `health endpoint returned HTTP ${response.status}`);
  } catch {
    return fail('api-reachability', 'health endpoint was unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the deployed web shell and its same-origin auth discovery route. A
 * homepage 200 is not enough evidence: a stale or misconfigured deployment
 * can serve marketing content while the login route or BFF cannot reach the
 * API. This probe reads status codes only and never consumes response bodies.
 */
export async function probeWeb(env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const raw = env.WEB_BASE_URL || env.NEXT_PUBLIC_WEB_URL;
  if (!raw) return fail('web-reachability', 'WEB_BASE_URL/NEXT_PUBLIC_WEB_URL is unavailable');
  const parsed = parseUrl(raw, 'web-reachability', {
    production: env.NODE_ENV === 'production',
    path: '',
  });
  if (!parsed.url) return parsed.finding;

  const failures = [];
  for (const path of WEB_SMOKE_PATHS) {
    const url = new URL(path, parsed.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'text/html,application/json' },
        signal: controller.signal,
      });
      if (!response.ok) failures.push(`${path} HTTP ${response.status}`);
    } catch {
      failures.push(`${path} unreachable`);
    } finally {
      clearTimeout(timer);
    }
  }

  return failures.length > 0
    ? fail('web-reachability', failures.join('; '))
    : pass('web-reachability', `${WEB_SMOKE_PATHS.length} web routes returned 2xx`);
}

export async function runDoctor({
  env = process.env,
  withNetwork = false,
  withDb = false,
  fetchImpl = fetch,
} = {}) {
  const findings = diagnoseEnvironment(env);
  if (withNetwork) {
    findings.push(await probeNetwork(env, fetchImpl));
    findings.push(await probeWeb(env, fetchImpl));
    findings.push(await probeRedis(env));
  } else {
    findings.push(
      warn('network-probes', 'skipped; re-run with --with-network to probe API and Redis'),
    );
  }
  if (withDb) findings.push(...(await probeDatabase(env)));
  else
    findings.push(
      warn(
        'database-probes',
        'skipped; re-run with --with-db to probe migrations and money switches',
      ),
    );
  return findings;
}

function printFindings(findings) {
  const width = Math.max(...findings.map((finding) => finding.name.length));
  for (const finding of findings) {
    const badge = finding.level === 'PASS' ? '  ok ' : finding.level === 'WARN' ? ' warn' : 'FAIL ';
    console.log(`[${badge}] ${finding.name.padEnd(width)}  ${finding.detail}`);
  }
  const failures = findings.filter((finding) => finding.level === 'FAIL').length;
  const warnings = findings.filter((finding) => finding.level === 'WARN').length;
  console.log(
    `\n${findings.length - failures - warnings} passed, ${warnings} warning(s), ${failures} failure(s)`,
  );
  if (failures > 0) {
    console.log('\nDeployment diagnosis failed. Resolve every FAIL above.');
    process.exitCode = 1;
  } else {
    console.log(
      '\nDeployment diagnosis passed; optional database/network probes were reported separately.',
    );
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  printFindings(
    await runDoctor({ withNetwork: args.has('--with-network'), withDb: args.has('--with-db') }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('deploy-doctor: unable to complete diagnostics');
    process.exitCode = 1;
  });
}
